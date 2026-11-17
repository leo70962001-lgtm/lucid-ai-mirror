/**
 * 教學的語音引導。
 *
 * 每一小步有一句口語的說明（i18n 的 teach.say.*，比字幕多一點語氣、一次只講一個動作），
 * 事先用 Gemini 的語音產生錄成 audio/<語言>/<步驟>.mp3（中、英、日各一套，同一個聲音）。
 * 播的順序：
 *   1. 有錄音就播錄音（網站、裝好的 App、APK）
 *   2. 拿不到錄音（單檔版、第一次用就沒網路）→ 用裝置內建的語音唸同一句
 *   3. 連內建語音都沒有 → 只看字幕
 * 同一個部位（同一組步驟）的每一句都有錄音才用錄音 —— 不要同一段示範裡一句是錄好的聲音、
 * 下一句變成機器的聲音。少一句就整個部位都用內建語音。
 *
 * 錄音用 fetch 抓成 blob 再播，不直接把網址交給 <audio>：<audio> 會用分段讀取（Range），
 * service worker 不存分段的回應，離線時就播不出來。
 * 整個 App 共用一個 <audio>：手機（尤其 iOS）只讓「使用者點過」的那個元素自己出聲，
 * 所以在按下 🔈 或進教學的那一下先用一小段無聲解鎖（voiceUnlock），之後換步才播得出來。
 */
import { getLang } from './i18n.js';

export const VOICE_LANG = { zh: 'zh-TW', en: 'en-US', ja: 'ja-JP' };
export const voiceClipUrl = (lang, key) => `audio/${lang}/${key}.mp3`;
/** 慢速示範時語音也放慢一點（瀏覽器會保持音高，不會變調） */
export const voiceRate = (slow) => (slow ? 0.85 : 1);
/** 示範最多等語音這麼久；語音卡住也不會讓示範停住不動 */
export const VOICE_HOLD_MS = 10000;

const VOICE_SILENT = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
const voiceBlobs = new Map();          // 錄音網址 → Promise<blob 網址 | null>
let voiceEl = null;                    // 共用的 <audio>
let voiceSeq = 0;                      // 每講一句加一；晚到的載入結果對不上號就丟掉
let voiceLoading = false;
let voiceMode = null;                  // 'clip' 正在播錄音、'tts' 正在用內建語音
let voiceLast = null;                  // 上一句是怎麼講的（'clip' / 'tts'）

function voiceAudio() {
  if (!voiceEl && typeof Audio === 'function') { voiceEl = new Audio(); voiceEl.preload = 'auto'; }
  return voiceEl;
}
function voiceBlob(url) {
  if (typeof fetch !== 'function') return Promise.resolve(null);
  if (!voiceBlobs.has(url)) {
    const p = (async () => {
      try {
        const r = await fetch(url);
        if (!r.ok) return '';                               // 這一句沒有錄音：記住，不要每一步都再問一次
        return URL.createObjectURL(await r.blob());
      } catch { return null; }                              // 連不上（可能只是暫時沒網路）
    })();
    voiceBlobs.set(url, p);
    p.then((u) => { if (u === null) voiceBlobs.delete(url); });   // 連不上的下次再試
  }
  return voiceBlobs.get(url);
}
function voiceTts(text, lang, slow) {
  try {
    if (!text || !('speechSynthesis' in globalThis)) return false;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = VOICE_LANG[lang] || VOICE_LANG.zh;
    u.rate = slow ? 0.8 : 0.95;
    speechSynthesis.speak(u);
    voiceMode = 'tts';
    return true;
  } catch { return false; }
}
function voiceQuiet() {
  try { if (voiceEl && !voiceEl.paused) voiceEl.pause(); } catch { /* 沒在播 */ }
  try { if ('speechSynthesis' in globalThis) speechSynthesis.cancel(); } catch { /* 沒有語音功能 */ }
  voiceMode = null;
}

/**
 * 講一句：key 是錄音的名字（例如 'cheek.sweep'、'done'），text 是同一句的文字（沒有錄音時給內建語音唸）。
 *   group：同一個部位全部的句子名字 —— 每一句都有錄音才播錄音（順便先載好，換步時不用等）
 *   soft： 這一句可有可無（示範結束的那一句）—— 沒有錄音而上一句是錄音時就不講，不要突然換成機器的聲音
 * 回傳 'clip'（播了錄音）、'tts'（內建語音）、null（沒出聲，或中途被下一句取代）。
 */
export async function voiceSay(key, text, { slow = false, lang = getLang(), group = null, soft = false } = {}) {
  const seq = ++voiceSeq;
  voiceQuiet();
  let src = null;
  if (!globalThis.__LUCID_SINGLEFILE__) {
    voiceLoading = true;
    const all = await Promise.all([key, ...(group || []).filter((k) => k !== key)].map((k) => voiceBlob(voiceClipUrl(lang, k))));
    if (seq !== voiceSeq) return null;
    voiceLoading = false;
    src = all.every(Boolean) ? all[0] : null;
  }
  if (src) {
    try {
      const a = voiceAudio();
      a.src = src;
      a.defaultPlaybackRate = a.playbackRate = voiceRate(slow);
      voiceMode = 'clip';
      await a.play();
      voiceLast = 'clip';
      return 'clip';
    } catch {
      if (seq !== voiceSeq) return null;      // 被下一句打斷，不是播不了
      voiceMode = null;
    }
  }
  if (soft && voiceLast === 'clip') return null;
  if (!voiceTts(text, lang, slow)) return null;
  voiceLast = 'tts';
  return 'tts';
}
/** 全部停掉（關語音、離開教學） */
export function voiceStop() {
  voiceSeq++;
  voiceLoading = false;
  voiceLast = null;
  voiceQuiet();
}
/** 示範暫停／繼續時語音跟著停、跟著接下去講 */
export function voicePause(on) {
  try {
    if (voiceMode === 'clip' && voiceEl && !voiceEl.ended) { if (on) voiceEl.pause(); else voiceEl.play()?.catch?.(() => {}); }
    else if (voiceMode === 'tts') { if (on) speechSynthesis.pause(); else speechSynthesis.resume(); }
  } catch { /* 停不了就讓它講完 */ }
}
/** 講到一半切換慢速 */
export function voiceSlow(slow) {
  try { if (voiceEl) voiceEl.defaultPlaybackRate = voiceEl.playbackRate = voiceRate(slow); } catch { /* 不支援變速就維持原速 */ }
}
/** 這一句還在講（或還在載入）嗎：示範用它決定要不要等一下再換步 */
export function voiceBusy() {
  if (voiceLoading) return true;
  if (voiceMode === 'clip') return !!voiceEl && !voiceEl.ended && !voiceEl.paused;
  if (voiceMode === 'tts') { try { return !!speechSynthesis.speaking; } catch { return false; } }
  return false;
}
/** 在使用者按下去的那一下呼叫：用一小段無聲把共用的 <audio> 解鎖 */
export function voiceUnlock() {
  try {
    const a = voiceAudio();
    if (!a || voiceBusy()) return;
    a.src = VOICE_SILENT;
    a.play()?.catch?.(() => {});
  } catch { /* 解不了鎖就等第一句自己試 */ }
}
/** 打開語音時把這個語言的錄音先抓一輪（service worker 會存起來），之後離線也有聲音；回傳抓到幾句 */
export async function voiceWarm(lang, keys) {
  if (globalThis.__LUCID_SINGLEFILE__) return 0;
  let n = 0;
  for (const k of keys) if (await voiceBlob(voiceClipUrl(lang, k))) n++;     // 一句一句來，不跟正在講的那一句搶頻寬
  return n;
}
