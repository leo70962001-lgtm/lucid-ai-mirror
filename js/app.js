/**
 * LUCID AI Smart Mirror — 五步驟流程控制
 *
 * Step 1 拍照 → Step 2 AI 分析推薦 → Step 3 商品推薦
 * → Step 4 AR 上妝 → Step 5 回饋
 */

import { initFace, detectImage, detectVideo } from './face.js';
import { renderMakeup, debugOverlay, LIPS_OUTER, EYE_R_ALL, EYE_L_ALL, SKIN_PATCHES } from './makeup.js';
import { setMakeup, setMakeupB, setSplit, setIntensity, setSweep, renderGL,
         screenToUV, brushDab, clearBrush, hasBrush, useBrush,
         beginStroke, undoStroke, redoStroke, strokeCount, redoCount,
         pressureLevel, applyPressure, COVERAGE, setLighting, resetRefs, setColorMatrix } from './makeup-gl.js';
import { loadChartQuad, fitFromCanvas, applyCCM, clearChartQuad } from './chart.js';
import { sampleSkin, classifySkin, rankLooks, estimateIlluminant, estimateHighlight, applyGain,
         rgbToLab, hexToLab, deltaE, ITA_CLASSES } from './analysis.js';
import { PRODUCTS, LOOKS, resolveLook, toneLabel, finishLabel, catLabel } from './products.js';
import { MOODS, WEATHERS, PLANS, contextAdvice, adjustIntensity, rankWithContext,
         moodFromFace, externalWeather } from './context.js';
import { lastBlendshapes, faceInfo } from './face.js';
import { onSkin, onLook, onPicks, onShadeChange, onAmount, onFinish, lightNote,
         optsForSkin, optsForPicks, optsForAR, optsForFinish, explain, optsAfterWhy, onAR,
         nearestRegion, onRegion, readGesture, plainSkin, plainFace, plainBlush, plainLook, plainCeleb,
         askAudience, askAudienceGuess, audienceBonus, plainGroom, askLevel, levelBonus, levelTip,
         adjustHint, shadeHint, buyAdvice, DIR_KEYS,
         dropAsked, dropDeadAmount, dropAnswers, AMOUNT_MIN, AMOUNT_MAX,
         askAmount, askContext, onContext, newPref, notePref, noteDwell, prefTone, pickNext,
         prefNote, prefRecall, observe, sessionSummary, DWELL_MS,
         colorStatus, colorLines, colorGuide, optsForColor, colorGuideOpts,
         plainSeason, askSeasonBase, askSeasonSplit, SEASON_ANSWER, explainSeason, seasonColors,
         seasonShadeLine, optsForSeason, optLearn, optQuiz } from './advisor.js';
import { seasonFeatures, classifySeason, personFit } from './season.js';
import { pickLesson, lessonLines, nextQuiz, onQuizAnswer, learnRecap } from './learn.js';
import { findHairline, faceFeatures, classifyFace, faceLookBonus, faceReasonFor } from './faceshape.js';
import { lineEmoji, optEmoji } from './emoji.js';
import { initGender, guessAudience } from './gender.js';
import { loadCalibration, correctHex } from './calib.js';
import { LANGS, t, tf, getLang, setLang, initLang, applyStatic } from './i18n.js';

// 顯示端校色：把「想讓顧客看到的顏色」換成「要送給這台螢幕的碼值」。
// 沒有校正資料時原樣回傳，所以未校正的機台一切照舊。
// 校正資料由 _calib.html 量測擬合後寫入 localStorage。
const CALIB = loadCalibration();
const dispCache = new Map();
function disp(hex) {
  if (!CALIB || !hex) return hex;
  if (!dispCache.has(hex)) dispCache.set(hex, correctHex(hex, CALIB).hex);
  return dispCache.get(hex);
}

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };

/** 推薦理由裡的 tone / finish 本身也是 key，要先各自翻好再代入 */
const trReason = ([key, vars]) => t(key, !vars ? null : {
  ...(vars.tone   ? { tone:   toneLabel(vars.tone) }     : {}),
  ...(vars.finish ? { finish: finishLabel(vars.finish) } : {}),
});

const S = {
  step: 1,
  stream: null,
  photo: null,      // 素顏照（已鏡像）
  photoLm: null,
  skin: null, illum: null, skinRaw: null, skinWB: false,
  // 季節（春夏秋冬）：照片量到的特徵、使用者的自我檢查回答、判斷結果
  seasonF: null, seasonAns: {}, season: null,
  // 美妝小教室：這一位客人學過的課、出過的題、答對幾題（下一位客人重來）
  learned: new Set(), quizDone: new Set(), quiz: { n: 0, ok: 0 }, curQuiz: null,
  // 情境：使用者告訴我們的，不是量出來的（見 js/context.js 開頭）
  ctx: { mood: null, weather: null, plan: null },
  ctxAuto: null, ctxFeed: false,
  advShade: [],                     // 顧問對「使用者自己換的色號」的回應
  zoom: false,                      // AR：唇部放大檢視
  lightNote: [],                    // AR：現場光線的誠實提示
  chat: {},                         // 各畫面的對話紀錄 { msgs, opts }
  // 互動的記憶：使用者做過什麼，之後的推薦要照著走（見 js/advisor.js〈偏好〉）
  pref: newPref(),
  amount0: null,                    // 第一次進配方時的濃度 —— 收尾要講「你自己調了多少」
  shadeT0: 0,                       // 這支色號是什麼時候換上的（停留時間 = 偏好的證據）
  prevLip: null,                    // 上一支唇色 —— 對話裡可以直接換回去
  said: new Set(),                  // AI 主動講過的事，一場只講一次
  mark: null,                       // 鏡面上要圈出來的部位（AI 講到哪就指到哪）
  sheet: { state: 'open', tab: 'ai', seen: '' },   // AR 的控制抽屜：open / min，ai / tune
  audience: 'any',                   // 想看哪一類的妝容（女性／男性／都可以）
  asked2: new Set(), q2: null,       // 推薦畫面問過的題目、目前等著回答的那一題
  level: null,                       // 化妝經驗：often / some / new（第一次）
  audGuess: null, audChosen: false,  // AI 自動判斷的結果（只當預設值）／使用者是否親自選過
  gesture: [],                      // 鼻尖軌跡（只在有是非題等著回答時才餵）
  yesNo: null,                      // 現在等著回答的是非題 { yes, no }
  lastAct: 0,                       // 使用者最後一次動作 —— 判斷「閒著」用
  asked3: new Set(),                // 配方畫面已經問過的題目（心情／天氣／行程／濃度）
  lastV: null,                      // 最近一次算出來的契合度（「這分數怎麼算的」要用）
  ranked: [],
  look: null,
  picks: null,      // { lip, eye, cheek }
  amount: { lip: 1, eye: 1, cheek: 1 },
  mode: 'full',     // full | bare（素顏對比）| dual（雙色對比）
  splitX: 0.5,      // 分界線在畫布上的位置（每一幀由臉中線 + splitOff 算出來）
  splitOff: 0,      // 分界線相對臉中線的偏移 —— 使用者拖的是這個
  pickB: null,      // 雙色模式下右半邊的唇色
  side: 'a',        // 色號列現在要套到哪一邊
  tab: 'lip',       // 細調分頁：唇 / 眼 / 頰 / 手動上妝
  finish: 'all',    // 色號列的質地篩選：all / matte / gloss / shimmer
  hist: [], redo: [],   // Step 4 的撤銷／重做
  shot: null, edited: null,               // 修圖的來源與成品
  brush: { tool: 'lip', size: 34, flow: 55, press: 65 },   // 手動上妝的虛擬刷具（press = 筆壓靈敏度）
  bag: [],
  tried: new Set(),   // 試過的唇色色號 —— 報告要講「你試了幾個」
  arMs: 0, arT0: 0,   // 實際停留在 AR 的時間
  rating: 0,
  tags: new Set(),
  raf: 0,
};

// ═══════════════ 啟動 ═══════════════
/**
 * 語言切換。切換後整頁重繪 —— 畫面上大量節點是 JS 產生的，
 * 維護兩套更新路徑（靜態 data-i18n 一套、動態節點一套）遲早會漏掉一處。
 * 重繪唯一要小心的是狀態：S 不動，所以照片、妝容、購物車都留著。
 */
function paintCalibTag() {
  $('#calib-tag').textContent = CALIB
    ? t('calib.on', { g: CALIB.gamma.map((g) => g.toFixed(2)).join('/') })
    : t('calib.off');
  // 色卡（_chart.html 設定過位置）也標出來：現場要知道膚色判定有沒有經過色卡校正
  if (loadChartQuad()) $('#calib-tag').textContent += ' · ' + t('chart.set');
}

// ── 介面設定：配色與圓角 ─────────────────────────────────
// 只換外框。影像框的中性灰、商品色票、AR 上妝顏色刻意不跟著變 —— 見 main.css。
// 色票圓點用各配色自己的主色（寫死），不能用 var(--rose)：那樣五顆都會是目前配色的顏色。
const THEMES = [['rose', '#d1738c'], ['gold', '#b38850'], ['lilac', '#8f74c9'], ['sage', '#5f9479'], ['mist', '#5f86b3']];
const SHAPES = ['soft', 'crisp'];
function readPref(k, d) { try { return localStorage.getItem(k) || d; } catch { return d; } }
function savePref(k, v) { try { localStorage.setItem(k, v); } catch { /* 無痕模式沒有 localStorage，不影響功能 */ } }

/** 把記住的配色套到 <html> 上。預設值不寫屬性 —— :root 本身就是預設 */
function applyLookPrefs() {
  const root = document.documentElement;
  const th = readPref('lucid-theme', 'rose'), sh = readPref('lucid-shape', 'soft');
  if (th === 'rose') delete root.dataset.theme; else root.dataset.theme = th;
  if (sh === 'soft') delete root.dataset.shape; else root.dataset.shape = sh;
}
applyLookPrefs();   // 模組一載入就套，開機畫面就是選好的配色，不會先閃一下粉紅

function mountSettings() {
  const btn = $('#set-btn'), box = $('#settings');
  btn.title = t('set.btn'); btn.setAttribute('aria-label', t('set.btn'));
  const th = readPref('lucid-theme', 'rose'), sh = readPref('lucid-shape', 'soft');
  box.innerHTML = '';
  box.appendChild(el('h4', '', t('set.color')));
  const colors = el('div', 'row');
  for (const [id, c] of THEMES) {
    const b = el('button', 'theme' + (th === id ? ' on' : ''));
    b.innerHTML = '<i style="--c:' + c + '"></i>';
    b.appendChild(el('span', '', t('theme.' + id)));
    b.onclick = () => { savePref('lucid-theme', id); applyLookPrefs(); mountSettings(); };
    colors.appendChild(b);
  }
  box.appendChild(colors);
  box.appendChild(el('h4', '', t('set.shape')));
  const shapes = el('div', 'row');
  for (const id of SHAPES) {
    const b = el('button', 'shape ' + id + (sh === id ? ' on' : ''), t('shape.' + id));
    b.onclick = () => { savePref('lucid-shape', id); applyLookPrefs(); mountSettings(); };
    shapes.appendChild(b);
  }
  box.appendChild(shapes);
  box.appendChild(el('p', 'note', t('set.note')));
  mountCalSettings(box);
  btn.onclick = () => { box.hidden = !box.hidden; btn.classList.toggle('on', !box.hidden); };
  // 這次可能量不準：齒輪上亮一個小點，提醒設定裡有東西可以處理
  btn.classList.toggle('alert', S.color?.level === 'needed' || S.color?.level === 'suggest');
}

/**
 * 設定面板的「顏色校正」：這次量得準不準、色卡設定了沒、螢幕校色了沒，以及去設定的按鈕。
 * 設定頁開在新分頁 —— 直接換頁的話，照片、對話、購物袋都會不見。
 */
function mountCalSettings(box) {
  const sec = el('div', 'cal'); sec.id = 'set-cal';
  sec.appendChild(el('h4', '', t('set.cal')));
  const st = S.color;
  const msg = !st ? t('set.cal.none')
    : st.reason === 'chart' ? t('set.cal.chart', { de: st.de.toFixed(1) })
    : t('set.cal.' + st.reason, { cct: st.cct ?? '—' });
  sec.appendChild(el('p', 'cal-st ' + (st?.level || 'none'), msg));
  const chartSet = !!loadChartQuad();
  sec.appendChild(el('p', 'cal-line', t(chartSet ? 'set.cal.chartSet' : 'set.cal.chartUnset') + '　·　' + (CALIB ? t('calib.on', { g: CALIB.gamma.map((g) => g.toFixed(2)).join('/') }) : t('calib.off'))));
  const row = el('div', 'row');
  // 假鏡頭測試頁（?chart=warm）就開模擬色卡的設定頁，流程才接得起來
  const sim = /[?&]chart=(\w+)/.exec(location.search)?.[1];
  const open = (url) => { if (!window.open(url, '_blank')) location.href = url; };
  const setBtn = el('button', 'cal-btn' + (st && st.level !== 'ok' ? ' hot' : ''), t('set.cal.setChart'));
  setBtn.onclick = () => open(sim ? '_chart.html?sim=' + sim : '_chart.html');
  row.appendChild(setBtn);
  if (chartSet) {
    const c = el('button', 'cal-btn', t('set.cal.clearChart'));
    c.onclick = () => { clearChartQuad(); chartSig = ''; paintCalibTag(); mountSettings(); };
    row.appendChild(c);
  }
  const d = el('button', 'cal-btn', t('set.cal.display'));
  d.onclick = () => open('_calib.html');
  row.appendChild(d);
  sec.appendChild(row);
  sec.appendChild(el('p', 'note', t('set.cal.help')));
  box.appendChild(sec);
}

/** 從對話打開設定並捲到指定區塊 */
function openSettings(section) {
  const box = $('#settings'), btn = $('#set-btn');
  mountSettings();
  box.hidden = false; btn.classList.add('on');
  const sec = section === 'cal' && $('#set-cal');
  if (sec) {
    sec.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    sec.classList.remove('flash'); void sec.offsetWidth; sec.classList.add('flash');
  }
}

// 在另一個分頁設定好色卡、回到這裡：更新設定面板，推薦畫面上請 AI 提醒重拍
let chartSig = (() => { try { return localStorage.getItem('lucid.chart') || ''; } catch { return ''; } })();
function onChartMaybeChanged() {
  let now = '';
  try { now = localStorage.getItem('lucid.chart') || ''; } catch { return; }
  if (now === chartSig) return;
  const added = !!now && !chartSig;
  chartSig = now;
  paintCalibTag(); mountSettings();
  if (added && S.step === 2 && S.photo) chatSay('s2', [{ kind: 'praise', key: 'adv.color.ready', params: {} }], [{ key: 'opt.retake', act: 'retake' }, ...s2Opts()]);
}
window.addEventListener('storage', (e) => { if (e.key === 'lucid.chart' || e.key === null) onChartMaybeChanged(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) onChartMaybeChanged(); });
window.addEventListener('focus', onChartMaybeChanged);
// 點面板以外的地方就收起來（按齒輪本身交給它自己的 onclick 切換）
document.addEventListener('pointerdown', (e) => {
  const box = $('#settings');
  if (!box || box.hidden || box.contains(e.target) || e.target.closest?.('#set-btn')) return;
  box.hidden = true; $('#set-btn').classList.remove('on');
});

function mountLang() {
  const box = $('#lang');
  box.innerHTML = '';
  for (const L of LANGS) {
    const b = el('button', getLang() === L.id ? 'on' : '', L.label);
    b.onclick = () => {
      if (getLang() === L.id) return;
      setLang(L.id);
      applyStatic();
      paintCalibTag();
      mountLang();
      mountSettings();
      lastSig = '';                    // 語言不影響貼圖，但重繪路徑一併走乾淨
      go(S.step);
    };
    box.appendChild(b);
  }
}

(async function boot() {
  initLang();
  applyStatic();
  mountLang();
  mountSettings();
  tickClock(); setInterval(tickClock, 10_000);
  // AR 的上一步是 AI 諮詢（中間不再經過商品頁）；商品推薦的上一步是剛才的試妝
  $('#back').onclick = () => go(S.step === 4 ? 2 : S.step === 5 ? (S.stream ? 4 : 3) : S.step - 1);

  try {
    setBoot(t('boot.camera'));
    S.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 960 }, facingMode: 'user' }, audio: false,
    });
    $('#cam').srcObject = S.stream;
    await $('#cam').play();
  } catch (e) {
    showCamError(e);
  }

  try {
    // 單檔離線版要先把內嵌的 base64 轉成 blob URL 才有東西可載
    if (globalThis.__LUCID_READY__) { setBoot(t('boot.assets')); await globalThis.__LUCID_READY__; }
    await initFace(setBoot);
    initGender();          // 性別判斷模型在背景載入，不擋開機；載不起來就退回用問的
  } catch (e) {
    setBoot(t('boot.modelFail'));
    $('#cam-err').hidden = false;
    $('#cam-err').innerHTML =
      `<b>${t('err.modelTitle')}</b><br><code>${e.message}</code><br>` +
      t('err.modelBody') + t('err.modelHint');
  }

  paintCalibTag();
  $('#calib-tag').style.color = CALIB ? 'var(--ok)' : 'var(--ink-3)';

  $('#boot').classList.add('gone');
  go(1);
})();

function setBoot(msg) { $('#boot-msg').textContent = msg; }
function tickClock() {
  const d = new Date();
  let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  $('#clock').textContent = `${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
}
function showCamError(e) {
  $('#hint').textContent = t('cam.none');
  $('#cam-err').hidden = false;
  const fileMode = location.protocol === 'file:';
  $('#cam-err').innerHTML =
    `<b>${t('cam.errTitle')}</b>（${e.name}）<br>` +
    (fileMode ? t('cam.errFile') : t('cam.errHttps')) + t('cam.errTail');
}

// ═══════════════ 流程切換 ═══════════════
// 畫面上顯示的步驟。拍照與推薦算同一步 —— 推薦要等拍完照才算得出來，
// 兩個畫面合不成一個，所以內部 5 個畫面對到畫面上 4 個步驟：
//   1 拍照 ┐
//   2 推薦 ┘ 第 1 步：拍照推薦・合成美妝
//   3 產品   第 2 步：推薦美妝產品
//   4 AR     第 3 步：推薦產品 AR 上妝體驗
//   5 評價   第 4 步：給正面評價（含體驗報告與購物）
// 內部畫面 → 顯示的步驟：拍照(1) → AI 諮詢(2) → AR 試妝(3，沒有鏡頭時用照片試妝) → 商品推薦(4)
const SHOWN = [0, 1, 2, 3, 3, 4];

function go(n) {
  n = Math.max(1, Math.min(5, n));
  if (n === 4 && !S.picks) return;
  if (S.step === 4 && S.arT0) { S.arMs += performance.now() - S.arT0; S.arT0 = 0; }
  // 離開 AR 就把第二層關掉 —— 否則評價頁的 AFTER 對照圖、推薦頁的縮圖
  // 會跟著變成半邊一個色號，報告與縮圖就不是「他實際看到的那張臉」了。
  if (n !== 4 && lastSigB !== 'null') { setMakeupB(null); lastSigB = 'null'; }
  if (n !== 4 && S.tab === 'paint') { S.tab = 'lip'; $('#s4')?.classList.remove('painting-mode'); const pb = $('#paintbar'); if (pb) pb.hidden = true; }
  S.step = n;
  cancelAnimationFrame(S.raf);

  $('#title').firstChild.textContent = t('step' + n + '.en');
  $('#subtitle').textContent = t('step' + n + '.tw');
  $('#back').disabled = n === 1;
  const shown = SHOWN[n];
  [...document.querySelectorAll('.pip')].forEach((p, i) => {
    p.className = 'pip' + (i + 1 === shown ? ' on' : i + 1 < shown ? ' done' : '');
  });
  for (let i = 1; i <= 5; i++) $('#s' + i).hidden = i !== n;
  $('#panel').hidden = n < 3;

  ({ 1: enter1, 2: enter2, 3: enter3, 4: enter4, 5: enter5 })[n]();
}

function setActions(list) {
  const box = $('#actions'); box.innerHTML = '';
  for (const a of list) {
    const b = el('button', 'btn ' + (a.cls || ''), a.label);
    b.disabled = !!a.disabled;
    b.onclick = a.on;
    box.appendChild(b);
  }
}

// ═══════════════ STEP 1 · 拍照 ═══════════════
function mountVideo(frame) {
  const v = $('#cam');
  if (v.parentElement !== frame) frame.insertBefore(v, frame.firstChild);
}

function enter1() {
  mountVideo($('#s1 .frame'));
  $('#count').hidden = true;
  setActions([
    { label: t('btn.upload'), cls: 'ghost', on: pickFile },
    { label: t('btn.take'), cls: 'primary', on: countdown, disabled: !S.stream },
  ]);
  guideLoop();
}

let lastProbe = 0, faceOk = false;
// 拍照失敗的訊息要停留幾秒：取景提示每 0.25 秒更新一次，
// 不擋住的話「偵測不到臉」會立刻被蓋回「請對準框內」，看起來就像按了沒反應。
let hintHoldUntil = 0, shooting = false, missCount = 0;

/** 在取景畫面顯示一則要讓人看到的訊息（失敗、錯誤），停留 ms 毫秒 */
function holdHint(text, ms = 3500) {
  hintHoldUntil = performance.now() + ms;
  const h = $('#hint');
  h.textContent = text;
  h.classList.remove('ok');
  const f = $('#s1 .frame');
  f.classList.remove('miss'); void f.offsetWidth; f.classList.add('miss');   // 重播一次提醒動畫
}
function guideLoop() {
  const v = $('#cam'), c = $('#guide'), ctx = c.getContext('2d');
  const draw = async (ts) => {
    if (S.step !== 1) return;
    const r = c.getBoundingClientRect();
    if (c.width !== r.width) { c.width = r.width; c.height = r.height; }
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);

    // 低頻偵測，只為了給提示，不必每幀跑
    if (v.readyState >= 2 && ts - lastProbe > 250) {
      lastProbe = ts;
      try {
        const lm = await detectImage(v);
        faceOk = !!lm && Math.abs(lm[1].x - 0.5) < 0.13 && lm[1].y > 0.28 && lm[1].y < 0.72;
      } catch { faceOk = false; }
      if (performance.now() > hintHoldUntil) {
        $('#hint').textContent = t(faceOk ? 'hint.ok' : 'hint.align');
        $('#hint').classList.toggle('ok', faceOk);
      }
    }

    const col = faceOk ? 'rgba(122,224,160,.9)' : 'rgba(214,124,148,.8)';
    const cx = W / 2, cy = H * 0.47, rx = W * 0.30, ry = H * 0.34;
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();

    ctx.setLineDash([6, 9]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(122,224,235,.45)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - ry - 26); ctx.lineTo(cx, cy + ry + 26);
    ctx.moveTo(cx - rx - 26, cy);  ctx.lineTo(cx + rx + 26, cy);
    ctx.stroke(); ctx.setLineDash([]);

    // 四角
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    const m = 18, L = 26;
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x + dx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * L); ctx.stroke();
    }
    S.raf = requestAnimationFrame(draw);
  };
  S.raf = requestAnimationFrame(draw);
}

function countdown() {
  if (shooting) return;                  // 倒數中再按一次不能再開一個倒數（會連拍好幾張）
  shooting = true;
  setTakeEnabled(false);
  const box = $('#count'); let n = 3;
  box.hidden = false; box.textContent = n;
  const t = setInterval(() => {
    if (--n <= 0) { clearInterval(t); box.hidden = true; capture(); }
    else box.textContent = n;
  }, 800);
}

function setTakeEnabled(on) {
  const b = $('#actions')?.lastChild;
  if (b && S.step === 1) b.disabled = !on || !S.stream;
}

/** 拍照：存成鏡像影像（跟使用者在鏡子裡看到的一致） */
async function capture() {
  const v = $('#cam');
  const W = 720, H = Math.round((v.videoHeight / v.videoWidth) * 720) || 960;
  const c = el('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.save(); ctx.scale(-1, 1); ctx.drawImage(v, -W, 0, W, H); ctx.restore();
  try {
    await analyse(c);
  } catch (e) {
    // 分析出錯不能靜靜停住 —— 照實說，並指出另一條路
    console.error(e);
    holdHint(t('hint.captureErr'), 6000);
  } finally {
    shooting = false;
    setTakeEnabled(true);
  }
}

function pickFile() {
  const inp = el('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => {
    const f = inp.files?.[0]; if (!f) return;
    const img = new Image();
    img.onload = async () => {
      const W = 720, H = Math.round((img.height / img.width) * 720);
      const c = el('canvas'); c.width = W; c.height = H;
      c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, W, H);
      try { await analyse(c, { chart: false }); }
      catch (e) { console.error(e); holdHint(t('hint.captureErr'), 6000); }
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  };
  inp.click();
}

// ═══════════════ STEP 2 · AI 分析 ═══════════════
async function analyse(photoCanvas, { chart = true } = {}) {
  const lm = await detectImage(photoCanvas);
  if (!lm) {
    // 連續失敗兩次：臉很可能其實在框裡，是這台裝置的偵測有問題 —— 把診斷資訊一起顯示，截圖就能遠端判斷
    missCount++;
    const fi = faceInfo();
    holdHint(t('hint.noFace') + (missCount >= 2
      ? '　' + t('hint.diag', { mode: fi.delegate, test: fi.selftest ? 'OK' : 'NG', w: photoCanvas.width, h: photoCanvas.height,
                               src: $('#cam').videoWidth + '×' + $('#cam').videoHeight })
      : ''), missCount >= 2 ? 9000 : 3500);
    return;
  }
  missCount = 0;

  const skinRaw = sampleSkin(photoCanvas, lm);
  if (!skinRaw) { holdHint(t('hint.noSkin')); return; }

  // 先估環境光再判膚色：櫃位燈光幾乎不會是 D65，
  // 不補償的話暖光會把每個人都推向暖色調。
  const illum = estimateIlluminant(photoCanvas, lm);
  // 色卡校正（參考 ZOZOGLASS）：鏡框邊裝了標準色卡、而且這張照片讀得到 → 優先用它
  // 上傳的照片沒有拍到機台的色卡，不讀（避免照片內容剛好被當成色卡）
  const quad = chart ? loadChartQuad() : null;
  S.chartFit = quad ? fitFromCanvas(photoCanvas, quad) : null;
  let useWB = !S.chartFit && illum?.reliable;
  let skinRgb = S.chartFit ? applyCCM(skinRaw.rgb, S.chartFit.M) : skinRaw.rgb;
  if (useWB) {
    const fixed = applyGain(skinRaw.rgb, illum.gain);
    // 校正後若有通道被夾到頂，代表這次的眼白取樣不可信 ——
    // 補償過頭會把膚色推成純白，後面的分析與推薦全部跟著錯。
    // 寧可不補償，也不要給出一個看起來很確定但完全錯的答案。
    if (fixed.some((v) => v >= 250)) useWB = false;
    else skinRgb = fixed;
  }

  S.photo = photoCanvas;
  S.photoLm = lm;
  S.illum = illum;
  // 渲染器用同一組增益把畫面換成反射率。眼白取樣不可信時就不補償 —— 寧可偏一點，也不要補過頭
  // 光線來源的優先序：眼白 → 臉上的高光 → 不補償。
  // 不補償時渲染器會把妝畫成完全受光的亮度，暗場景下妝會比臉亮，所以要有中間這一層。
  const hl = useWB ? null : estimateHighlight(photoCanvas, lm);
  if (S.chartFit) { setLighting([1, 1, 1]); setColorMatrix(S.chartFit.M); }
  else { setColorMatrix(null); setLighting(useWB ? illum.gainWide : (hl?.reliable ? hl.gain : [1, 1, 1])); }
  resetRefs();
  S.skinRaw = skinRaw.rgb;
  S.skinWB = useWB || !!S.chartFit;
  // 這次量得準不準：沒用上眼白（不可信或補償過頭）就當作沒有參考
  S.color = colorStatus({ chartSet: !!quad, chart: S.chartFit, illum: useWB ? illum : null });
  mountSettings();
  S.skin = classifySkin(skinRgb);
  if (DEBUG) globalThis.__LUCID_S2__ = { raw: skinRaw.rgb, rgb: skinRgb, skin: S.skin, chart: S.chartFit, wb: useWB, illum };
  // 臉型：先在照片上找髮際線（找不到才用比例估），再量長寬與下顎線條
  S.hair = findHairline(photoCanvas, lm);
  S.faceF = faceFeatures(lm, photoCanvas.width, photoCanvas.height, S.hair);
  S.face = classifyFace(S.faceF);
  // 季節：膚色＋瞳孔＋頭髮（量得到才算）。眼白只有真的用上時才拿來算黑白分明
  S.seasonF = seasonFeatures(photoCanvas, lm, S.skin, S.hair, useWB ? illum : null);
  S.seasonAns = {};
  S.season = classifySeason(S.seasonF);
  S.faceBonus = faceLookBonus(S.face);
  // AI 自動判斷先排哪一類妝容：使用者親自選過就不再猜；沒把握（< 85%）或模型沒載好就不猜
  if (!S.audChosen) {
    S.audGuess = await guessAudience(photoCanvas, lm).catch(() => null);
    S.audience = S.audGuess?.audience || 'any';
    S.asked2.delete('audience');       // 新照片、使用者沒親自選過 → 用新的判斷再確認一次
  }
  S.faceLines = false;
  // 推薦順序 = 膚色契合 + 臉型加分。score 仍然只代表膚色契合，臉型另外記 —— 兩種依據不混在一個數字裡
  rankAll();
  // 心情先用表情猜一個預設值，使用者可以改；天氣如果機台有餵資料就直接帶入
  S.ctxAuto = moodFromFace(lastBlendshapes());
  const feed = externalWeather(location.search);
  S.ctxFeed = !!feed;
  S.ctx = { mood: S.ctxAuto, weather: feed, plan: null };
  S.look = null;
  go(2);
}

/**
 * 上妝動畫。使用者反覆說「沒有效果」—— 就算渲染是對的，
 * 瞬間切換本來就不容易察覺，眼睛沒有可以比對的前一刻。
 * 0.62 秒漸入之後，差別會變得無法忽略。
 */
const APPLY_MS = 900;
const easeOut = (t) => 1 - (1 - t) ** 3;

// 掃掠的起訖（UV 的 v）。0.28 貼在眉骨、0.86 在下唇之下 ——
// 兩端都要留出頭尾，否則會看到妝「從眼皮正中間開始長出來」。
const SWEEP_FROM = 0.28, SWEEP_TO = 0.86;

let applyT0 = 0;
const startApply = () => { applyT0 = performance.now(); };

/**
 * 目前這一幀的上妝狀態。
 * 不用整體淡入，而是一道由上往下的掃掠 —— 臉部 UV 的排列剛好是
 * 眼 0.36 → 頰 0.48 → 唇 0.69，所以掃下來就是真實的上妝順序，
 * 而且刷頭前緣帶一道亮邊，看得出「正在被畫上去」而不是「忽然出現」。
 */
function applyPhase() {
  if (holdBare) return { k: 0, sweep: -1 };
  if (!applyT0) return { k: 100, sweep: -1 };
  const t = (performance.now() - applyT0) / APPLY_MS;
  if (t >= 1) { applyT0 = 0; return { k: 100, sweep: -1 }; }
  // 刷頭用 smoothstep 而不是 easeOut：easeOut 會在前 1/3 就掃過整張臉，
  // 眼影腮紅唇彩擠在同一瞬間出現，等於沒有順序可言。
  const e = t * t * (3 - 2 * t);
  return { k: 100, sweep: SWEEP_FROM + e * (SWEEP_TO - SWEEP_FROM) };
}

/**
 * 按住畫面 = 暫時卸妝，放開就回來。
 * 「有沒有差別」用說的沒有用，讓人自己按一下最快 ——
 * 而且比 BEFORE/AFTER 分屏好，因為同一個位置前後對照，
 * 不必用左右兩邊不同的臉去腦補。
 */
let holdBare = false;
/**
 * 浮在鏡面上的按鈕（模式切換、撤銷／重做）是 .frame 的子元素，
 * 所以按它們時 pointerdown 會先冒泡到鏡面上。鏡面的手勢（按住卸妝、
 * 拖分界線、手繪）一定要讓開 —— 對比模式下鏡面會 setPointerCapture，
 * 放開時的 click 就被改派給鏡面本身，按鈕的 onclick 永遠不會觸發：
 * 進得了「素顏對比」卻再也切不回「全臉」，而且每點一次分界線就跳到游標那裡。
 */
const onControl = (e) => !!e.target.closest?.('button, input, select, a');

function bindHold(frame, onChange) {
  const set = (v) => {
    if (holdBare === v) return;
    holdBare = v;
    frame.classList.toggle('bare', v);
    if (onChange) onChange();
  };
  frame.dataset.bare = t('ba.bareTag');   // CSS 的 ::after 讀這個，跟著語言換
  frame.onpointerdown = (e) => { if (onControl(e)) return; e.preventDefault(); set(true); };
  frame.onpointerup = frame.onpointerleave = frame.onpointercancel = () => set(false);
}

/**
 * Step 2 上方的大圖：look 為 null 時顯示帶關鍵點的素顏，
 * 選了妝容就把該妝容套上去（同一支 GL 渲染器，跟 Step 4 完全一致）。
 */
let photoLook = null, photoRAF = 0;

function paintPhoto(k, sweep = -1) {
  const c = $('#shot'), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(S.photo, 0, 0);
  if (!photoLook) {
    ctx.fillStyle = 'rgba(214,124,148,.8)';
    for (let i = 0; i < S.photoLm.length; i += 6) {
      ctx.fillRect(S.photoLm[i].x * c.width - 1, S.photoLm[i].y * c.height - 1, 2, 2);
    }
    if (S.faceLines) drawFaceLines(ctx);
    return;
  }
  setIntensity(k); setSweep(sweep); useBrush(false);
  resetRefs();   // 在照片上渲染：唇與皮膚的亮度基準要從這張圖重新量
  renderGL(ctx, toPixels(S.photoLm, c.width, c.height), c.width, c.height);
  if (S.faceLines) drawFaceLines(ctx);
}

function showOnPhoto(look, animate = true) {
  const c = $('#shot');
  c.width = S.photo.width; c.height = S.photo.height;
  photoLook = look;
  cancelAnimationFrame(photoRAF);
  $('#shot-hint').hidden = !look;
  if (!look) { paintPhoto(0); return; }

  setMakeup(glCfgFor(resolveLook(look, S.skin.undertone, seasonFit()), look.intensity, look));
  setSplit(-1);
  lastSig = '';          // 動過貼圖，主流程下次一定要重建
  if (!animate) { paintPhoto(100); return; }

  startApply();
  (function frame() {
    const ph = applyPhase();
    paintPhoto(ph.k, ph.sweep);
    if (ph.sweep >= 0) photoRAF = requestAnimationFrame(frame);
  })();
}

/** 有季節結果時，挑色號用「這個顏色有多像你的季節」；介於兩季之間時兩邊都算 */
const seasonFit = () => (S.season ? (p) => personFit(p, S.season) : null);

/** 妝容卡片。對象（女性／男性）改變時會重排，所以獨立出來 */
function renderLooks() {
  const s = S.skin;
  const box = $('#looks'); box.innerHTML = '';
  S.ranked.forEach(({ look, why }, rank) => {
    // 縮圖用「偵測到的膚色」+「這個妝容實際會用到的商品色」畫，
    // 所以它不是示意圖，是這組推薦的真實預覽。
    const pk = resolveLook(look, s.undertone, seasonFit());
    const vars = [
      `--skin:${s.hex}`, `--lip:${disp(pk.lip.color)}`, `--eye:${disp(pk.eye.color)}`, `--cheek:${disp(pk.cheek.color)}`,
      // 46px 的縮圖上，眼影與腮紅照原強度會看不見，這裡放大到可辨識。
      // 唇色幾乎不動，因為它是使用者最在意、也最會拿來對照 Step 4 的部位。
      `--lipA:${Math.min(1, look.intensity.lip * 1.1).toFixed(2)}`,
      `--eyeA:${Math.min(1, look.intensity.eye * 1.9).toFixed(2)}`,
      `--cheekA:${Math.min(1, look.intensity.cheek * 1.9).toFixed(2)}`,
      `--lipGloss:${pk.lip.finish === 'gloss' ? 0.9 : 0}`,
    ].join(';');

    const b = el('button', 'look' + (S.look?.id === look.id ? ' on' : ''));
    // 先放 CSS 抽象小臉當底，等一下若能算出真實縮圖就換掉 ——
    // 沒有 WebGL 或還沒拍照時仍然有東西可看，不會開天窗。
    b.innerHTML =
      `<div class="face" style="${vars}">
         <i class="lid l"></i><i class="lid r"></i>
         <i class="lash l"></i><i class="lash r"></i>
         <i class="blush l"></i><i class="blush r"></i>
         <i class="lips"></i>
       </div>
       <div class="txt">
         <div class="top"><b>${tf(look, 'name')}</b>${rank === 0 ? `<span class="best">${t('look.best')}</span>` : ''}</div>
         <div class="why">${cardWhy(look, why)}</div>
       </div>`;
    b.dataset.look = look.id;
    b.onclick = () => {
      S.look = look;
      [...box.children].forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      $('#actions').lastChild.disabled = false;
      advise2();      // 選了妝容 → 顧問接著講這款跟膚色的關係
      // 上方大圖同步套上該妝容 —— 縮圖看得出差別，大圖才看得清楚細節
      showOnPhoto(look, true);
    };
    box.appendChild(b);

    // 換成使用者本人套上該妝容的真實縮圖
    const thumb = lookThumb(look, 74, 92);
    if (thumb) {
      thumb.className = 'thumb';
      b.replaceChild(thumb, b.firstElementChild);
    }
  });
}

function enter2() {
  showOnPhoto(S.look, false);
  bindHold($('#s2 .frame'), () => paintPhoto(holdBare ? 0 : 100, -1));

  const s = S.skin;
  $('#tone-sw').style.background = s.hex;
  $('#tone-name').textContent = t('tone.name', { depth: t('depth.' + s.depthKey), tone: toneLabel(s.undertone) });
  const wb = S.illum && S.skinWB
    ? t('wb.ok', { cct: S.illum.cct ? S.illum.cct + 'K' : '', n: S.illum.samples })
    : t(S.illum ? 'wb.bad' : 'wb.none');
  $('#tone-meta').textContent = t('tone.meta', { wb });
  $('#tone-nums').innerHTML =
    `${s.hex.toUpperCase()}<br>L* ${s.lab.L.toFixed(1)}　a* ${s.lab.a.toFixed(1)}　b* ${s.lab.b.toFixed(1)}<br>ITA ${s.itaDeg.toFixed(1)}°`;

  const warns = [...s.warnings];
  if (!S.skinWB) warns.push(t('warn.noWB'));
  $('#tone-warn').hidden = !warns.length;
  advise2(true);
  $('#tone-warn').textContent = warns.length ? '⚠ ' + warns.join('　') : '';

  renderLooks();

  setActions([
    { label: t('btn.retake'), cls: 'ghost', on: () => go(1) },
    { label: t('btn.pickLook'), cls: 'primary', disabled: !S.look, on: () => {
        applyContext();
        go(S.stream ? 4 : 3);          // 建議之後直接進 AR；商品留到體驗完再推薦
      } },
  ]);
}

/**
 * 推薦順序 = 膚色契合 + 臉型加分 + 對象加分。
 * score 仍然只代表膚色契合；另外兩項分開記，不混在一個數字裡。
 */
function rankAll() {
  const ab = audienceBonus(LOOKS, S.audience);
  const cb = contextAdvice(S.ctx).look;          // 心情、天氣、行程說了什麼，對應的妝容加分
  const lb = levelBonus(LOOKS, S.level);         // 第一次化妝 → 清淡好上手的往前排
  S.ranked = rankLooks(LOOKS, S.skin)
    .map((r) => {
      const fb = S.faceBonus?.[r.look.id] || 0, aud = ab[r.look.id] || 0, ctx = cb[r.look.id] || 0, lv = lb[r.look.id] || 0;
      return { ...r, faceBonus: fb, audBonus: aud, ctxBonus: ctx, lvlBonus: lv, total: r.score + fb + aud + ctx + lv };
    })
    .sort((x, y) => y.total - x.total);
}

// ═══════════════ STEP 3 · 商品推薦 ═══════════════
let prevRAF = 0;
function paintPreview(k, sweep) {
  const c = $('#preview'), ctx = c.getContext('2d', { willReadFrequently: true });
  if (c.width !== S.photo.width) { c.width = S.photo.width; c.height = S.photo.height; }
  ctx.drawImage(S.photo, 0, 0);
  syncMakeup();
  setSplit(-1); setIntensity(k); setSweep(sweep); useBrush(false);
  resetRefs();   // 在照片上渲染：唇與皮膚的亮度基準要從這張圖重新量
  if (!renderGL(ctx, toPixels(S.photoLm, c.width, c.height), c.width, c.height)) {
    renderMakeup(ctx, S.photo, S.photoLm, cfg());
  }
}

// ── AI 顧問：把量到的數字翻成句子 ────────────────────────
// 規則寫在 js/advisor.js：每一句都掛在一個量到的數字上，撐不起來就不硬誇。
// 這裡只負責顯示，並把句子的「依據種類」標出來（肯定／量測／建議／留意）。
function advLine(l) {
  const p = { ...l.params };
  if (p.tone) p.tone = toneLabel(p.tone);
  if (p.mine) p.mine = toneLabel(p.mine);
  if (p.cat) p.cat = catLabel(p.cat);
  if (p.why) p.why = t(p.why);
  if (p.guess) p.guess = t(p.guess);      // 情境三題的選項本身也是文案鍵
  if (p.choice) p.choice = t(p.choice);
  for (const k of ['faceWhy', 'skinWhy', 'shape', 'second', 'trait', 'tip', 'range', 'chin']) if (p[k]) p[k] = t(p[k]);
  if (p.look) { const lk = LOOKS.find((x) => x.id === p.look); if (lk) p.look = tf(lk, 'name'); }
  if (Array.isArray(p.names)) p.names = p.names.map((n) => tf(n, 'name')).join(t('list.sep'));
  if (p.depth) p.depth = t(p.depth);        // 追問用到的分帶名稱同樣是文案鍵
  for (const k of ['shade', 'lip', 'eye', 'cheek']) {
    const prod = typeof p[k] === 'string' && PRODUCTS.find((x) => x.id === p[k]);
    if (prod) p[k] = tf(prod, 'shade');
  }
  if (p.band) p.band = t(p.band);
  for (const k of ['season', 'colors', 'avoid', 'its', 'answer', 'warm']) if (typeof p[k] === 'string') p[k] = t(p[k]);
  if (Array.isArray(p.topics)) p.topics = p.topics.map((id) => t('learn.' + id + '.name')).join(t('list.sep'));
  if (p.alt) { const lk = LOOKS.find((x) => x.id === p.alt); if (lk) p.alt = tf(lk, 'name'); }
  return t(l.key, p);
}

// ── 對話式顧問 ──────────────────────────────────────────
// AI 說完就給選項，點了就照做，然後接著回話。選項只有「機器做得到」的動作。
const CHAT = { s2: '#adv2', s3: '#adv3', s4: '#adv4', s5: '#adv5' };

// ── 對話的節奏 ─────────────────────────────────────────
// AI 的回覆先顯示「輸入中…」再一句一句出現。一次倒出一整段，看起來像公告，不像對話。
// 節奏刻意短（第一句 0.42 秒、之後每句 0.38 秒）—— 是為了讀得出「一來一回」，不是為了拖時間。
// 偏好減少動態效果的使用者、以及網址帶 ?fast 時，全部立刻顯示。
const REPLY_DELAY = 420, LINE_GAP = 380;
const instantChat = () => /[?&]fast(=|&|$)/.test(location.search) ||
  !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 幫新的 AI 訊息排出現時間：first = 第一句要等多久（剛被使用者點選時 > 0，開場時 0） */
function schedule(msgs, first) {
  if (instantChat()) return msgs;
  const now = performance.now();
  msgs.forEach((m, i) => { if (m.who === 'ai') m.revealAt = now + first + i * LINE_GAP; });
  return msgs;
}

function chatReset(where, lines, opts) {
  const old = S.chat[where];
  if (old?.timer) clearTimeout(old.timer);
  S.chat[where] = { msgs: schedule(lines.map((l) => ({ who: 'ai', l })), 0), opts: opts || [] };
  mountChat(where);
}
const sigOf = (l) => l.key + JSON.stringify(l.params);

/** 同一類的舊評語先移除再講新的 —— 例如一直換妝容時，不該把每一款的評語全疊上去 */
function chatReplace(where, keys, lines, opts) {
  const c = (S.chat[where] ||= { msgs: [], opts: [] });
  c.msgs = c.msgs.filter((m) => !(m.who === 'ai' && keys.includes(m.l.key)));
  // 換掉舊評語會留下「後面沒有 AI 回應」的孤兒氣泡（它的回覆剛剛被換走了）。
  // 那些只留最後一句 —— 不然連按幾次就疊成一排「你：…」，看起來像鬼打牆。
  const kept = [];
  let aiAfter = false, orphanKept = false;
  for (let i = c.msgs.length - 1; i >= 0; i--) {
    const m = c.msgs[i];
    if (m.who === 'ai') { aiAfter = true; kept.push(m); continue; }
    if (aiAfter) { kept.push(m); continue; }
    if (orphanKept) continue;
    orphanKept = true; kept.push(m);
  }
  c.msgs = kept.reverse();
  chatSay(where, lines, opts);
}

function chatSay(where, lines, opts) {
  const c = (S.chat[where] ||= { msgs: [], opts: [] });
  const added = [];
  for (const l of lines) {
    // 同一句話不連著講第二次 —— 那是對話繞回原點的主要來源
    const last = [...c.msgs].reverse().find((m) => m.who === 'ai');
    if (last && sigOf(last.l) === sigOf(l)) continue;
    const m = { who: 'ai', l };
    c.msgs.push(m); added.push(m);
  }
  // 緊接在使用者的選擇之後 → 先「輸入中」一下；AI 自己主動開口 → 直接出現第一句
  const replying = c.msgs[c.msgs.length - added.length - 1]?.who === 'you';
  schedule(added, replying ? REPLY_DELAY : 0);
  if (opts) c.opts = opts;
  mountChat(where);
}
function chatYou(where, key, emo = '') {
  const c = (S.chat[where] ||= { msgs: [], opts: [] });
  const text = (emo ? emo + ' ' : '') + t(key);
  // 連按同一個選項時，不要把同一句「你：…」一直疊上去
  const last = c.msgs[c.msgs.length - 1];
  if (!(last && last.who === 'you' && last.text === text)) c.msgs.push({ who: 'you', text });
  c.opts = [];
  mountChat(where);
}

function mountChat(where) {
  const box = $(CHAT[where]); if (!box) return;
  const c = S.chat[where] || { msgs: [], opts: [] };
  // 重畫之前記住捲動位置：使用者往上翻舊訊息時，不能因為重畫就被拉回底部
  const oldLog = box.querySelector('.log');
  const prevTop = oldLog ? oldLog.scrollTop : 0;
  const atBottom = !oldLog || oldLog.scrollHeight - oldLog.scrollTop - oldLog.clientHeight < 40;
  box.innerHTML = '';
  box.hidden = !c.msgs.length;
  if (!c.msgs.length) return;
  box.appendChild(el('div', 'who', t('adv.who')));
  // 對話一律是聊天的樣子：AI 頭像＋左側氣泡、自己的選擇在右側、快速回覆在下方
  const inSheet = where === 's4';
  const log = el('div', 'log');
  const now = performance.now();
  let pendingAt = 0, prevWho = null;
  let fresh = false;
  // 對話區固定高度、自己往上捲，所以可以多留一些歷史，往上滑就看得到
  for (const m of c.msgs.slice(-24)) {
    // 還沒輪到的訊息先不畫，改畫一個「輸入中」氣泡；後面的也一起等
    if (m.who === 'ai' && m.revealAt > now) { pendingAt = m.revealAt; break; }
    if (m.who === 'you') {
      const row = el('div', 'msg you', m.text);
      if (!m.shown) { row.classList.add('new'); m.shown = true; fresh = true; }
      log.appendChild(row); prevWho = 'you'; continue;
    }
    const row = el('div', 'msg ai ' + m.l.kind + (prevWho === 'ai' ? ' cont' : ''));   // 連續的 AI 訊息只在第一則放頭像
    if (prevWho !== 'ai') row.appendChild(el('i', 'avatar', 'AI'));
    const bubble = el('div', 'bubble');
    // 句子開頭的表情符號已經看得出是哪一類（建議 💡、提問 💬、例子 🌟…），種類標籤不再每句都掛。
    // 只留「你說的」：那句話的依據是客人自己的回答、不是量測 —— 這個差別要一直看得到。
    bubble.appendChild(el('span', 'emo', lineEmoji(m.l)));
    if (m.l.kind === 'told') bubble.appendChild(el('span', 'k', t('adv.kind.told')));
    bubble.appendChild(el('span', 'x', advLine(m.l)));
    // 季節的代表色：一排小色票，看一眼就知道是哪種感覺
    if (m.l.params?.swatches) {
      const sw = el('span', 'swatches');
      for (const c of m.l.params.swatches) { const i = el('i'); i.style.background = c; sw.appendChild(i); }
      bubble.appendChild(sw);
    }
    row.appendChild(bubble);
    if (!m.shown) { row.classList.add('new'); m.shown = true; fresh = true; }
    log.appendChild(row); prevWho = 'ai';
  }
  if (pendingAt) {
    const row = el('div', 'msg ai typing' + (prevWho === 'ai' ? ' cont' : ''));
    if (prevWho !== 'ai') row.appendChild(el('i', 'avatar', 'AI'));
    row.appendChild(el('div', 'bubble', '<i></i><i></i><i></i>'));
    log.appendChild(row);
    clearTimeout(c.timer);
    c.timer = setTimeout(() => { if (S.chat[where] === c) mountChat(where); }, Math.max(30, pendingAt - now));
  }
  box.appendChild(log);
  // 新訊息或「輸入中」出現時捲到底；使用者正在往上看舊訊息、又沒有新訊息時，留在原位
  log.onscroll = () => log.classList.toggle('more', log.scrollTop > 4);
  const toBottom = fresh || pendingAt || atBottom;
  log.scrollTop = toBottom ? log.scrollHeight : prevTop;
  requestAnimationFrame(() => {
    if (toBottom) log.scrollTop = log.scrollHeight;      // 字型與動畫排版完才是真正的高度
    log.classList.toggle('more', log.scrollTop > 4);
  });
  let opts = dropDeadAmount(dropAsked(c.opts, c.asked), S.amount);
  // 全部被收掉就退回預設 —— 對話永遠要留得下一步，這是最後一道保險
  if (!opts.length) opts = dropDeadAmount(dropAsked(defaultOpts(where), c.asked), S.amount);
  // 快速回覆等 AI 講完才出現 —— 話還沒說完就先給選項，對話的順序就亂了
  if (pendingAt) opts = [];
  if (opts.length) {
    const row = el('div', 'opts');
    for (const o of opts) {
      const e = optEmoji(o);
      const b = el('button', '', (e ? `<span class="emo">${e}</span>` : '') + t(o.key));
      b.onclick = () => chatAct(where, o);
      row.appendChild(b);
    }
    box.appendChild(row);
  }
  if (where === 's5') box.appendChild(el('div', 'foot', t('adv.note')));
  if (inSheet) syncSheet();
}

// ── AR 的控制抽屜 ───────────────────────────────────────
// 鏡子是主角：抽屜可以收到只剩一條（目前色號＋AI 最新一句），要調整或聊天時再拉開。
// AI 有新的話時不強制打開抽屜 —— 只在分頁上亮一個點，收起來的那一條也會換成新的那句。

/**
 * 抽屜打開時把鏡面畫面往上推抽屜高度的一半。
 * 抽屜蓋住的是鏡面下半部 —— 剛好是嘴唇，而唇是試妝最需要看的地方。
 * 推上去之後，下緣露出的空白正好藏在抽屜後面。點擊與拖曳的座標換算用的是畫布的實際位置，所以不受影響。
 */
function liftMirror() {
  const sh = $('#sheet'), s4 = $('#s4'); if (!sh || !s4) return;
  requestAnimationFrame(() => {
    const h = sh.getBoundingClientRect().height, H = s4.clientHeight;
    // 調整分頁比較高：往上推會把眼睛推出畫面，所以改成整面縮小、放進抽屜上方（修圖 App 的做法）
    const painting = s4.classList.contains('painting-mode');
    const fit = !painting && S.sheet.state === 'open' && S.sheet.tab === 'tune';
    if (painting) { s4.style.setProperty('--mirror-scale', '1'); s4.style.setProperty('--lift', '0px'); return; }
    const scale = fit ? Math.max(0.5, Math.min(1, (H - h - 14) / H)) : 1;
    s4.style.setProperty('--mirror-scale', scale.toFixed(3));
    s4.style.setProperty('--lift', (fit ? -6 : Math.round(Math.min(h * 0.5, H * 0.22))) + 'px');
  });
}
addEventListener('resize', () => { if (S.step === 4) liftMirror(); });

function mountSheet() {
  const sh = $('#sheet'); if (!sh) return;
  const flip = () => { S.sheet.state = S.sheet.state === 'min' ? 'open' : 'min'; syncSheet(); };
  $('#sheet-toggle').onclick = flip;
  $('#sheet-grip').onclick = flip;
  // 收起來時點那一條任何地方都能打開 —— 按鈕太小，手機上不好點
  $('#sheet-peek').onclick = () => { if (S.sheet.state === 'min') { S.sheet.state = 'open'; syncSheet(); } };
  for (const b of sh.querySelectorAll('.sheet-tabs button')) {
    b.onclick = () => {
      const same = S.sheet.tab === b.dataset.tab && S.sheet.state === 'open';
      S.sheet.tab = b.dataset.tab;
      S.sheet.state = same ? 'min' : 'open';     // 再點一次目前的分頁 = 收起來
      syncSheet();
    };
  }
  syncSheet();
}

function syncSheet() {
  const sh = $('#sheet'); if (!sh) return;
  const c = S.chat.s4;
  const lastAI = c ? [...c.msgs].reverse().find((m) => m.who === 'ai') : null;
  const sig = lastAI ? sigOf(lastAI.l) : '';
  const reading = S.sheet.state === 'open' && S.sheet.tab === 'ai';
  if (reading) S.sheet.seen = sig;
  sh.dataset.state = S.sheet.state;
  sh.dataset.tab = S.sheet.tab;
  sh.classList.toggle('unread', !!sig && sig !== S.sheet.seen);
  for (const b of sh.querySelectorAll('.sheet-tabs button')) b.classList.toggle('on', b.dataset.tab === S.sheet.tab && S.sheet.state === 'open');
  $('#sheet-toggle').textContent = S.sheet.state === 'min' ? '⌃' : '⌄';
  $('#sheet-peek').textContent = lastAI ? lineEmoji(lastAI.l) + ' ' + advLine(lastAI.l) : '';
  liftMirror();
  const p = S.picks?.lip;
  if (p) $('#sheet-shade').innerHTML = `<i style="background:${disp(p.color)}"></i><span>${tf(p, 'shade')}</span>`;
}

/** 每個畫面的預設選項 —— 對話走到沒得點的時候，用它把路接回來 */
function defaultOpts(where) {
  if (where === 's2') return s2Opts();
  if (where === 's3') return S.picks ? optsForPicks(S.picks, S.skin, S.pref) : [];
  if (where === 's4') return S.picks ? arOpts() : [];
  return optsForFinish();
}

/** 點了選項：先把使用者說的話記進對話，再執行，最後回話 */
function chatAct(where, o) {
  S.lastAct = performance.now();           // 有人在互動 → 主動開口的計時重來
  if (where === 's4' && !o._gesture) { S.yesNo = null; S.gesture = []; }
  const c = (S.chat[where] ||= { msgs: [], opts: [] });
  const prevOpts = c.opts;
  (c.asked ||= new Set()).add(o.act);      // 問過的「為什麼」不再出現在選項裡
  chatYou(where, o.key, optEmoji(o));
  const r = runAct(o) || {};
  if (r.stay === false) return;                 // 換頁的動作，對話在新畫面重建
  // 動作沒帶新選項回來（例如沒東西可換）時，把原本那排放回去 ——
  // chatYou 會先清空選項，不還回去的話對話就停在那裡沒得點了。
  if (!r.opts) r.opts = dropAnswers(prevOpts);
  // 「目前狀態」型的句子用取代，不然反覆調整會把幾乎一樣的話疊滿整個面板
  if (r.replace) chatReplace(where, r.replace, r.lines || [], r.opts);
  else chatSay(where, r.lines || [], r.opts);
}

// 夾限跟選項的判斷用同一組常數 —— 兩邊不一致就會出現「點了沒反應但選項還在」
const clamp1 = (v) => Math.min(AMOUNT_MAX, Math.max(AMOUNT_MIN, v));

/**
 * 配方畫面的提問順序。
 *
 * 情境三題排在濃度前面 —— 它們會改變挑出來的商品，先問才有意義。
 * 心情跟天氣如果機器已經猜到了，就改成「確認」：猜了不講、直接當成事實用，
 * 是這台機器最不該做的事。
 */
const Q_ORDER = ['mood', 'weather', 'plan', 'amount'];
const CTX_ITEMS = {
  mood:    MOODS.map((id) => ({ id, key: 'ctx.mood.' + id })),
  weather: WEATHERS.map((id) => ({ id, key: 'ctx.weather.' + id })),
  plan:    PLANS.map((id) => ({ id, key: 'ctx.plan.' + id })),
};

function nextQuestion() {
  for (const q of Q_ORDER) {
    if (S.asked3.has(q)) continue;
    S.asked3.add(q);
    if (q === 'amount') return askAmount(S.amount.lip);
    // 自己在面板上點過的就不用再問一次
    if (S.ctx[q] && !(q === 'mood' && S.ctxAuto) && !(q === 'weather' && S.ctxFeed)) continue;
    const guess = q === 'mood' ? S.ctxAuto : q === 'weather' && S.ctxFeed ? S.ctx.weather : null;
    return askContext(q, CTX_ITEMS[q], guess);
  }
  return null;
}

/** 答完一題就接著問下一題 —— 問到底之後回到平常的選項 */
function afterAnswer(lines) {
  const q = nextQuestion();
  const base = optsForPicks(S.picks, S.skin, S.pref);
  return { lines: [...lines, ...(q ? q.lines : [])], opts: q ? [...q.opts, ...base] : base };
}

/** 解釋之後的選項：追問排前面，原本能做的事全部留著（問過的由 dropAsked 收掉） */
function whyOpts(group) {
  const follow = optsAfterWhy(group === 'skin' ? 's2' : 's5');
  // AR 裡也問得到膚色那幾題 —— 底下接的是 AR 本來能做的事，不是推薦畫面的
  const base = S.step === 4 ? arOpts() : S.step === 5 ? optsForFinish() : s2Opts();
  return [...follow, ...base];
}

// ── 把話指回臉上 ────────────────────────────────────────
// 講「量到 762 點眼白」的時候，鏡子上就把那兩塊圈起來。
// 數字留在文字裡、臉上什麼都不標，使用者只能選擇相信；圈出來才查得證。
const MARK_SETS = {
  lip:    { poly: [LIPS_OUTER] },
  eye:    { poly: [EYE_R_ALL, EYE_L_ALL] },
  sclera: { poly: [EYE_R_ALL, EYE_L_ALL] },
  cheek:  { dots: [50, 101, 205, 280, 330, 425] },
  skin:   { dots: SKIN_PATCHES },              // sampleSkin 真正量的那 10 塊
};
const MARK_MS = 2600;

function markFace(kind) {
  if (!MARK_SETS[kind]) return;
  S.mark = { kind, t0: performance.now() };
}

/** 在鏡面上把 AI 剛才講到的地方圈出來，2.6 秒後自己淡掉 */
function drawMark(ctx, lm, W, H) {
  if (!S.mark || !lm) return;
  const age = performance.now() - S.mark.t0;
  if (age > MARK_MS) { S.mark = null; return; }
  const set = MARK_SETS[S.mark.kind];
  const fade = age < 200 ? age / 200 : Math.min(1, (MARK_MS - age) / 500);
  const P = toPixels(lm, W, H);
  ctx.save();
  ctx.globalAlpha = 0.9 * fade;
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 4;
  for (const poly of set.poly || []) {
    ctx.beginPath();
    poly.forEach((i, k) => { const p = P[i]; if (!p) return; k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.closePath(); ctx.stroke();
  }
  const r = Math.max(4, Math.round(Math.min(W, H) * 0.012));
  for (const i of set.dots || []) {
    const p = P[i]; if (!p) continue;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

/**
 * 點鏡子裡的臉 —— 想問哪裡就點哪裡。
 * 回的是那個部位量到的東西，同時把下面的細調分頁切過去（點了就該能直接調）。
 */
function tapRegion(px, py, W, H) {
  if (!smooth || !S.picks) return false;
  const P = toPixels(smooth, W, H);
  const mid = (idx) => { const ps = idx.map((i) => P[i]).filter(Boolean);
    return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length }; };
  const span = Math.hypot(P[234].x - P[454].x, P[234].y - P[454].y);   // 臉寬：判定半徑跟著人遠近縮放
  const lip = mid(LIPS_OUTER), eyeR = mid(EYE_R_ALL), eyeL = mid(EYE_L_ALL);
  const kind = nearestRegion({ x: px, y: py }, [
    { kind: 'lip',   ...lip,  r: span * 0.22 },
    { kind: 'eye',   ...eyeR, r: span * 0.18 },
    { kind: 'eye',   ...eyeL, r: span * 0.18 },
    { kind: 'cheek', ...mid([50, 101, 205]),  r: span * 0.17 },
    { kind: 'cheek', ...mid([280, 330, 425]), r: span * 0.17 },
    { kind: 'skin',  ...mid([151, 9, 10]),    r: span * 0.30 },
  ]);
  if (!kind) return false;
  S.lastAct = performance.now();
  if (kind === 'lip' || kind === 'eye' || kind === 'cheek') {
    S.tab = kind; mountTabs(); mountPanel(); mountModes();
  }
  markFace(kind);
  const p = S.picks[kind === 'skin' ? 'lip' : kind];
  const lines = onRegion(kind, kind === 'skin'
    ? { ...S.skin, patches: SKIN_PATCHES.length }
    : { shade: tf(p, kind === 'lip' ? 'shade' : 'name'), amount: S.amount[kind],
        tone: p.tone, de: deltaE(hexToLab(p.color), S.skin.lab) });   // 底調交給 advLine 翻，這裡傳原值
  chatYou('s4', 'you.tapped.' + kind);
  chatSay('s4', lines, kind === 'skin' ? whyOpts('skin') : arOpts());
  return true;
}

/**
 * 推薦畫面的提問順序：想看哪一類妝容 → 心情 → 天氣 → 行程。
 * 這四題都會改變推薦哪一款，所以在推薦畫面就問，而不是等到商品頁。
 * 一次只問一題：答完才問下一題，每答一題卡片就重排。
 * 問過的情境題也記進 asked3 —— 使用者如果沒答完就先去看商品，商品頁會接著問剩下的。
 */
const Q2_ORDER = ['weather', 'mood', 'plan', 'audience', 'level', 'seasonBase', 'seasonSplit'];

function nextQuestion2() {
  for (const q of Q2_ORDER) {
    if (S.asked2.has(q)) continue;
    S.asked2.add(q);
    if (q === 'audience') {
      if (S.audChosen) continue;
      return { id: q, ...(S.audGuess?.audience ? askAudienceGuess(S.audGuess.audience) : askAudience()) };
    }
    if (q === 'level') return { id: q, ...askLevel() };
    // 季節：照片分得開就不問；冷暖不確定問金銀飾，同一邊分不開問明度或清濁那一題
    if (q === 'seasonBase') { if (!S.season?.baseUnsure) continue; return { id: q, ...askSeasonBase() }; }
    if (q === 'seasonSplit') { if (!S.season?.split) continue; return { id: q, ...askSeasonSplit(S.season.split) }; }
    S.asked3.add(q);
    const guess = q === 'mood' ? S.ctxAuto : q === 'weather' && S.ctxFeed ? S.ctx.weather : null;
    return { id: q, ...askContext(q, CTX_ITEMS[q], guess) };
  }
  return null;
}

/** 推薦畫面的選項：還在問問題時只給答案＋「直接看建議」；建議給完才出現其他選項 */
function s2Opts() {
  if (S.q2) return [...S.q2.opts, { key: 'opt.skipQs', act: 'skipQs' }];
  return [...optsForSkin(S.ranked, S.look), ...optsForSeason(S.season), ...optsForColor(S.color), optLearn(), optQuiz()];
}

/** 問完之後的建議：臉型、膚色、小技巧，最後是「我會先從哪一款開始」 */
function suggest2() {
  $('#s2').dataset.phase = 'suggest';
  const tip = S.audience === 'men' ? plainGroom() : plainBlush(S.face);
  return [...plainFace(S.face), ...plainSkin(S.skin), ...plainSeason(S.season), ...colorLines(S.color), ...tip, ...levelTip(S.level, 's2'),
          { kind: 'praise', key: 'adv.ctxDone', params: { look: S.ranked[0].look.id } }];
}

/** 推薦畫面答完一題：接著問下一題；全部問完就給綜合推薦 */
function afterAnswer2(lines) {
  S.q2 = nextQuestion2();
  const tail = S.q2 ? S.q2.lines : suggest2();
  return { lines: [...lines, ...tail], opts: s2Opts() };
}

/** AR 的選項：有上一支色號時才給「換回剛才那支」 */
const arOpts = () => [...optsForAR(S.zoom, S.mode, !!S.prevLip), { key: 'opt.paintSelf', act: 'paintSelf' }, optLearn()];

/**
 * 把「在現在這支上停了多久」記進偏好。
 * 停留時間是使用者沒說出口的評價：真的喜歡才會停下來看。
 * 要在**挑下一支之前**先記 —— 不然挑的當下，剛剛那支還沒算進偏好。
 */
function noteShadeDwell() {
  if (!S.shadeT0 || !S.picks?.lip) return;
  noteDwell(S.pref, S.picks.lip, performance.now() - S.shadeT0);
  S.shadeT0 = performance.now();
}

function switchLip(next, reason) {
  const prev = S.picks.lip;
  noteShadeDwell();
  S.prevLip = prev;
  S.shadeT0 = performance.now();
  S.picks.lip = { ...next, _reason: [[reason || 'reason.manual']], _alts: [] };
  S.tried.add(next.id);
  startApply(); paintPanel(); updateCallout();
  if (S.step === 3) renderStep3();
  return prev;
}

function runAct(o) {
  switch (o.act) {
    // 解釋完接著給追問 —— 被問第二次還答得出來，才叫肯回答
    // 不想一題一題回答：剩下的題目跳過，直接給建議
    case 'skipQs': {
      for (const q of Q2_ORDER) S.asked2.add(q);
      S.q2 = null;
      return { lines: [{ kind: 'fact', key: 'adv.skipQs', params: {} }, ...suggest2()], opts: s2Opts() };
    }
    // 想看哪一類的妝容：重排卡片，接著講對應的小技巧
    case 'audWomen': case 'audMen': case 'audAny': case 'audKeep': {
      if (o.act !== 'audKeep') S.audience = o.act === 'audMen' ? 'men' : o.act === 'audWomen' ? 'women' : 'any';
      S.audChosen = true;                  // 使用者親自選過：之後重拍也不再用 AI 猜的蓋掉
      rankAll();
      renderLooks();
      return afterAnswer2([{ kind: 'fact', key: 'adv.audGot2.' + S.audience, params: {} }]);
    }
    // 平常有在化妝嗎：第一次的人，推薦偏清淡、濃度調低，每一步各給一句提醒
    case 'lvlOften': case 'lvlSome': case 'lvlNew': {
      S.level = o.act === 'lvlNew' ? 'new' : o.act === 'lvlSome' ? 'some' : 'often';
      rankAll();
      renderLooks();
      return afterAnswer2([{ kind: 'fact', key: 'adv.lvlGot.' + S.level, params: {} }]);
    }
    // AI 怎麼判斷的：照實講模型、把握度、門檻，以及資料不離開機器
    case 'whyAud':
      return { lines: [{ kind: 'fact', key: 'adv.whyAud', params: { p: Math.round((S.audGuess?.prob || 0) * 100) } }],
               opts: s2Opts() };
    // 臉型是怎麼看的：數字在這裡講，同時把量的線畫在照片上
    case 'whyFace':
      S.faceLines = true;
      if (S.step === 2) showOnPhoto(S.look, false);
      return { lines: explain('face', { f: S.faceF, cls: S.face }), opts: [...optsAfterWhy('face'), ...optsForSkin(S.ranked, S.look)] };
    case 'whyCeleb':
      return { lines: explain('celeb'), opts: optsForSkin(S.ranked, S.look) };
    case 'whyTone':
      markFace('skin');
      return { lines: explain('tone', S.skin), opts: whyOpts('skin') };
    case 'whyDepth':
      markFace('skin');
      return { lines: explain('depth', S.skin && { ...S.skin, band: ITA_CLASSES.find((c) => S.skin.itaDeg > c.min) }),
               opts: whyOpts('skin') };
    case 'whyLight':
      markFace('sclera');       // 講「取到幾點眼白」的時候，就把眼白圈出來
      // 白平衡的來源與樣本數 —— 量不到就照實說判定會比較不穩
      return { lines: S.chartFit
                 ? [{ kind: 'fact', key: 'adv.whyLightChart', params: { n: S.chartFit.used, raw: S.chartFit.raw.toFixed(1), de: S.chartFit.de.toFixed(1) } }]
                 : explain('light', S.illum || { reliable: false, samples: 0 }), opts: whyOpts('skin') };
    case 'whyPick': {
      const lips = PRODUCTS.filter((p) => p.cat === 'lip' && p.stock > 0);
      const fit = lips.filter((p) => p.tone === S.skin.undertone || p.tone === 'neutral');
      return { lines: explain('pick', { total: lips.length, n: fit.length, tone: S.skin.undertone }),
               opts: whyOpts('skin') };
    }
    case 'whyHue':      markFace('cheek'); return { lines: explain('hue', S.lastV), opts: whyOpts('score') };
    case 'whyLevel':    markFace('lip'); return { lines: explain('level', S.lastV), opts: whyOpts('score') };
    case 'whyStandout': markFace('lip'); return { lines: explain('standout', S.lastV), opts: whyOpts('score') };
    case 'useTop': {
      S.look = S.ranked[0].look;
      applyContext();
      showOnPhoto(S.look, true);
      markLookCard();
      return { lines: [...plainLook(S.ranked, S.look, S.face, S.skin), ...plainCeleb(S.face, S.audience)],
               replace: ['adv.p.lookFace', 'adv.p.lookSkin', 'adv.p.lookMen', 'adv.p.lookAlt', 'adv.p.celeb', 'adv.p.celebMen'],
               opts: optsForSkin(S.ranked, S.look) };
    }
    // 從對話直接前進時，配方要先算 —— 平常是「選定妝容」那顆按鈕做的
    case 'goProducts': if (S.look) applyContext(); go(S.stream ? 4 : 3); return { stay: false };
    // 沒有相機（上傳照片的流程）時，點了不能就這樣沉默 —— 沉默看起來就是壞掉
    case 'startAR':
      if (!S.stream) return { lines: [{ kind: 'caution', key: 'adv.noCam', params: {} }],
                              opts: optsForPicks(S.picks, S.skin, S.pref) };
      go(4); return { stay: false };
    case 'whyMatch': return { lines: explain('match', S.lastV), opts: whyOpts('score') };
    case 'retry': go(2); return { stay: false };
    // 顏色校正的引導：先講為什麼可能偏，再給「換光線重拍」與「設定色卡」兩條路
    case 'colorHow': return { lines: colorGuide(S.color), opts: colorGuideOpts() };
    // ── 季節 ──
    case 'whySeason': return { lines: explainSeason(S.season) };
    case 'seasonColors': return { lines: seasonColors(S.season, PRODUCTS) };
    case 'seaGold': case 'seaSilver': case 'seaDunno': case 'seaCoral': case 'seaBrick': case 'seaSharp': case 'seaHeavy': {
      const ans = SEASON_ANSWER[o.act], before = S.season?.season;
      if (ans) S.seasonAns[ans[0]] = ans[1];
      S.season = classifySeason(S.seasonF, S.seasonAns);
      rankAll(); renderLooks();
      const lines = [{ kind: 'told', key: ans ? 'adv.seasonGot' : 'adv.seasonGotDunno', params: {} }];
      if (S.season && S.season.season !== before) lines.push({ kind: 'fact', key: 'adv.seasonChanged', params: { season: 'season.' + S.season.season } });
      return afterAnswer2(lines);
    }
    // ── 美妝小教室：配合當下（AR 裡正在調的品項、季節、經驗、對象）挑一課 ──
    case 'paintSelf': {
      enterPaint();
      return { lines: [{ kind: 'tip', key: 'adv.paint.start', params: {} }] };
    }
    case 'learn': {
      const lesson = pickLesson({ cat: S.step === 4 && S.tab !== 'paint' ? S.tab : null, season: S.season?.season,
                                  level: S.level, audience: S.audience, learned: S.learned });
      if (lesson) S.learned.add(lesson.id);
      return { lines: lessonLines(lesson, S.season?.season) };
    }
    case 'quiz': {
      const q = nextQuiz(PRODUCTS, S.quizDone);
      if (!q) return { lines: [{ kind: 'fact', key: 'quiz.done', params: {} }] };
      S.quizDone.add(q.id); S.curQuiz = q;
      return { lines: q.lines, opts: q.opts };
    }
    case 'quizAns': {
      const r = onQuizAnswer(S.curQuiz, o.val);
      if (S.curQuiz) { S.quiz.n++; if (r.ok) S.quiz.ok++; }
      S.curQuiz = null;
      return { lines: r.lines };
    }
    case 'colorOpen':
      openSettings('cal');
      return { lines: [{ kind: 'tip', key: 'adv.color.opened', params: {} }], opts: [{ key: 'opt.retake', act: 'retake' }, ...s2Opts()] };
    case 'colorLater': return { lines: [{ kind: 'fact', key: 'adv.color.later', params: {} }], opts: s2Opts() };
    case 'retake': go(1); return { stay: false };
    case 'toNeutral': {
      // 把跟底調相反的那幾件換成中性色 —— 中性色不會跟膚色打架
      let n = 0;
      for (const cat of ['lip', 'eye', 'cheek']) {
        const p = S.picks[cat];
        if (!p || p.tone === 'neutral' || p.tone === S.skin.undertone) continue;
        const alt = PRODUCTS.filter((x) => x.cat === cat && x.tone === 'neutral' && x.stock > 0)[0];
        if (alt) { S.picks[cat] = { ...alt, _reason: [['reason.neutral']], _alts: [] }; n++; }
      }
      renderStep3(); paintPanel();
      return { lines: [{ kind: 'fact', key: 'adv.didNeutral', params: { n } }, ...onPicks(S.picks, S.skin)],
               opts: optsForPicks(S.picks, S.skin, S.pref) };
    }
    case 'softer': case 'stronger': {
      const k = o.act === 'softer' ? 0.7 : 1.3;
      const before = JSON.stringify(S.amount);
      for (const cat of ['lip', 'eye', 'cheek']) S.amount[cat] = clamp1(S.amount[cat] * k);
      if (JSON.stringify(S.amount) === before) {
        // 已經到頂或到底 —— 照實說，不要回一句跟剛才一樣的話
        return { lines: [{ kind: 'fact', key: o.act === 'softer' ? 'adv.atMin' : 'adv.atMax', params: {} }],
                 opts: S.step === 3 ? optsForPicks(S.picks, S.skin, S.pref) : arOpts() };
      }
      startApply();
      if (S.step === 3) renderStep3(); else { mountPanel(); paintPanel(); }
      const lip = Math.round(S.amount.lip * 100);
      return { lines: [{ kind: 'fact', key: o.act === 'softer' ? 'adv.didSofter' : 'adv.didStronger', params: { n: lip } },
                       ...(S.step === 4 ? adjustHint('lip', S.amount.lip, S.ctx, S.level) : onAmount('lip', S.amount.lip))],
               replace: ['adv.didSofter', 'adv.didStronger', 'adv.amountLow', 'adv.amountHigh', ...DIR_KEYS],
               opts: S.step === 3 ? optsForPicks(S.picks, S.skin, S.pref) : arOpts() };
    }
    case 'nextShade': {
      const list = PRODUCTS.filter((p) => p.cat === 'lip' && p.stock > 0);
      noteShadeDwell();                                     // 先結算這一支的停留時間
      const next = pickNext(list, S.picks.lip.id, S.pref);   // 再依「停留過的底調」優先挑
      if (!next) return {};
      const prev = switchLip(next);
      return { lines: [...onShadeChange(next, prev, S.skin), ...prefNote(S.pref, next),
                       ...shadeHint(next, PRODUCTS.filter((p) => p.cat === 'lip'), S.ctx, S.level),
                       ...seasonShadeLine(next, S.season, PRODUCTS.filter((p) => p.cat === 'lip'))],
               replace: ['adv.shadeGap', 'adv.shadeSame', 'adv.shadeNeutral', 'adv.shadeOff', 'adv.prefTone',
                         'adv.dir.shadeWork', 'adv.dir.shadeNew', 'adv.dir.shadeParty',
                         'adv.season.shadeFit', 'adv.season.shadeOff'],
               opts: arOpts() };
    }
    // 換回剛才那支 —— 對話裡的「上一步」，不用回頭找哪一顆是它
    case 'revert': {
      if (!S.prevLip) return {};
      const back = S.prevLip;
      switchLip(back);
      return { lines: [{ kind: 'fact', key: 'adv.didRevert', params: { shade: tf(back, 'shade') } }],
               replace: ['adv.shadeGap', 'adv.shadeSame', 'adv.shadeNeutral', 'adv.shadeOff',
                         'adv.prefTone', 'adv.didRevert'],
               opts: arOpts() };
    }
    // 回答「今天想低調還是明顯」：答案會真的改變濃度，而且記進偏好
    case 'prefSoft': case 'prefBold': case 'prefKeep': {
      if (o.act !== 'prefKeep') {
        notePref(S.pref, o.act === 'prefSoft' ? 'soft' : 'bold');
        const k = o.act === 'prefSoft' ? 0.7 : 1.3;
        for (const cat of ['lip', 'eye', 'cheek']) S.amount[cat] = clamp1(S.amount[cat] * k);
        startApply();
        if (S.step === 3) renderStep3(); else { mountPanel(); paintPanel(); }
      }
      const key = o.act === 'prefSoft' ? 'adv.prefSoft' : o.act === 'prefBold' ? 'adv.prefBold' : 'adv.prefKeep';
      const lines = [{ kind: 'fact', key, params: { n: Math.round(S.amount.lip * 100) } }];
      return S.step === 3 ? afterAnswer(lines) : { lines, opts: arOpts() };
    }
    // 回答情境三題 —— 答案是「使用者說的」，不是量到的，所以標成「你說的」
    case 'ctxMood': case 'ctxWeather': case 'ctxPlan': {
      const kind = o.act === 'ctxMood' ? 'mood' : o.act === 'ctxWeather' ? 'weather' : 'plan';
      S.ctx[kind] = o.val;
      if (kind === 'mood') S.ctxAuto = null;      // 已經問過本人了，不用再標「機器猜的」
      if (kind === 'weather') S.ctxFeed = false;
      const why = contextAdvice(S.ctx).reasons.find((r) => r.kind === kind);
      const got = onContext(kind, 'ctx.' + kind + '.' + o.val, why?.key);
      if (S.step === 2) { rankAll(); renderLooks(); return afterAnswer2(got); }
      applyContext(); renderStep3();
      return afterAnswer(got);
    }
    case 'ctxSkip': {
      S.ctx[o.val] = null;
      if (o.val === 'mood') S.ctxAuto = null;
      if (o.val === 'weather') S.ctxFeed = false;
      if (S.step === 2) { rankAll(); renderLooks(); return afterAnswer2(onContext(o.val, null)); }
      applyContext(); renderStep3();
      return afterAnswer(onContext(o.val, null));
    }
    // 回答「要不要換成對比最大的那一支」
    case 'keepBest': {
      const best = bestTried();
      if (!best) return {};
      switchLip(best.p);
      return { lines: [{ kind: 'fact', key: 'adv.didBest',
                         params: { shade: tf(best.p, 'shade'), de: best.de.toFixed(1) } }],
               replace: ['adv.shadeGap', 'adv.shadeSame', 'adv.shadeNeutral', 'adv.shadeOff', 'adv.prefTone'],
               opts: arOpts() };
    }
    // 照著記住的偏好換唇色 —— 「之後的推薦會從這個方向開始」要真的做得到
    case 'usePref': {
      const tone = prefTone(S.pref);
      const cand = PRODUCTS.filter((p) => p.cat === 'lip' && p.stock > 0 && p.tone === tone);
      // 同底調裡挑停留最久的那一支；沒停留過就挑跟膚色差最小的（最不容易出錯的那支）
      const best = cand.map((p) => ({ p, ms: S.pref.kept.find((k) => k.id === p.id)?.ms || 0,
                                      de: deltaE(hexToLab(p.color), S.skin.lab) }))
                       .sort((x, y) => y.ms - x.ms || x.de - y.de)[0];
      if (!best) return {};
      switchLip(best.p, 'reason.manual');
      renderStep3();
      return { lines: [{ kind: 'fact', key: 'adv.didPref',
                         params: { shade: tf(best.p, 'shade'), tone, sec: Math.round(best.ms / 1000) } }],
               opts: optsForPicks(S.picks, S.skin, S.pref) };
    }
    // 「要留這支嗎」—— 留著就記進偏好（收尾會講），不留就直接換下一支
    case 'keepYes': {
      noteDwell(S.pref, S.picks.lip, Math.max(DWELL_MS, performance.now() - (S.shadeT0 || 0)));
      return { lines: [{ kind: 'fact', key: 'adv.keptYes',
                         params: { shade: tf(S.picks.lip, 'shade'), n: S.pref.kept.length } }],
               opts: arOpts() };
    }
    case 'keepNo': return runAct({ act: 'nextShade' });
    // 把今天試過的放進購物袋：唇彩一件，或三件（缺貨的跳過）
    case 'buyLip': case 'buyAll': {
      const cats = o.act === 'buyLip' ? ['lip'] : ['lip', 'eye', 'cheek'];
      let n = 0;
      for (const c of cats) {
        const p = S.picks?.[c];
        if (p && p.stock > 0 && !S.bag.includes(p.id)) { S.bag.push(p.id); n++; }
      }
      paintRecItems(); paintTotal();
      const items = S.bag.map((id) => PRODUCTS.find((p) => p.id === id)).filter(Boolean);
      return { lines: [{ kind: 'fact', key: 'adv.buy.added', params: { n: items.length, sum: items.reduce((s, p) => s + p.price, 0) } }],
               opts: [...buyAdvice(S.picks, S.level).opts.filter((x) => !bagHas(x.act)), ...optsForFinish()] };
    }
    case 'noThanks':
      return { lines: [{ kind: 'fact', key: 'adv.keepCur', params: { shade: tf(S.picks.lip, 'shade') } }],
               opts: arOpts() };
    case 'compare': case 'dual': {
      const want = o.act === 'compare' ? 'bare' : 'dual';
      const off = S.mode === want;                 // 再按一次就是關掉，跟畫面上的模式鈕同一個意思
      S.mode = off ? 'full' : want;
      if (S.mode === 'dual' && !S.pickB) S.pickB = altShade();
      $('#before').hidden = S.mode !== 'full';
      S.splitOff = 0; startApply(); mountModes(); mountPanel();
      const key = off ? (o.act === 'compare' ? 'adv.didCompareOff' : 'adv.didDualOff')
                      : (o.act === 'compare' ? 'adv.didCompare' : 'adv.didDual');
      return { lines: [{ kind: 'fact', key,
                         params: { a: tf(S.picks.lip, 'shade'), b: S.pickB ? tf(S.pickB, 'shade') : '' } }],
               replace: ['adv.didCompare', 'adv.didDual', 'adv.didCompareOff', 'adv.didDualOff'],
               opts: arOpts() };
    }
    case 'zoom': {
      S.zoom = !S.zoom; mountZoomBtn();
      return { lines: [{ kind: 'fact', key: S.zoom ? 'adv.didZoom' : 'adv.didZoomOff', params: {} }],
               replace: ['adv.didZoom', 'adv.didZoomOff'],
               opts: arOpts() };
    }
    default: return {};
  }
}

/**
 * 拉濃度時給方向。拖曳中每一格都講會變成洗版，所以停手 0.35 秒才講一次，
 * 而且同類的舊提示換成新的，不疊上去。
 */
let hintTimer = 0;
function hintSoon(cat) {
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    if (S.step !== 4) return;
    S.lastAct = performance.now();
    chatReplace('s4', DIR_KEYS, adjustHint(cat, S.amount[cat], S.ctx, S.level), arOpts());
  }, 350);
}

/** AR 畫面：現場光線的提示 + 使用者剛做的那件事的回應 */
function advise4(extra = [], fresh = false, opts = null) {
  const o = opts || arOpts();
  if (fresh || !S.chat.s4?.msgs?.length) chatReset('s4', [...S.lightNote, ...extra], o);
  // 光線提示是「狀態」不是「事件」：狀態變了就換掉舊的那句，不要一直疊
  else if (extra.some((l) => l.key.startsWith('adv.light')))
    chatReplace('s4', ['adv.lightDark', 'adv.lightFallback', 'adv.lightNone'], extra, o);
  else chatSay('s4', extra, o);
}

/**
 * 餵一筆鼻尖位置給手勢判定，並在認出來的時候直接當成答案。
 *
 * 只在有是非題等著回答時才會被呼叫。認出來之後先說「我當成點頭了」再執行 ——
 * 手勢會誤判，所以一定要讓使用者看得到機器把它當成什麼，按鈕也一直都在。
 */
function feedGesture(lm, W, H, now = performance.now()) {
  if (!S.yesNo || !lm) return null;
  const P = toPixels(lm, W, H);
  const span = Math.hypot(P[234].x - P[454].x, P[234].y - P[454].y) || 1;
  const cx = (P[234].x + P[454].x) / 2, cy = (P[10].y + P[152].y) / 2;
  S.gesture.push({ t: now, x: (P[1].x - cx) / span, y: (P[1].y - cy) / span });
  if (S.gesture.length > 90) S.gesture.shift();
  const g = readGesture(S.gesture, now);
  if (!g) return null;
  const opt = g === 'nod' ? S.yesNo.yes : S.yesNo.no;
  S.yesNo = null; S.gesture = [];
  chatSay('s4', [{ kind: 'caution', key: g === 'nod' ? 'adv.gotNod' : 'adv.gotShake', params: {} }]);
  chatAct('s4', opt);
  return g;
}

/** 試過的色號裡，跟量到的膚色對比最大的那一支（現在這支不算 —— 問了等於沒問） */
function bestTried() {
  if (!S.skin) return null;
  const out = [...S.tried]
    .map((id) => PRODUCTS.find((x) => x.id === id))
    .filter((p) => p && p.cat === 'lip' && p.id !== S.picks?.lip?.id)
    .map((p) => ({ p, de: deltaE(hexToLab(p.color), S.skin.lab) }))
    .sort((x, y) => y.de - x.de)[0];
  return out || null;
}

/**
 * AI 主動開口。
 *
 * 規則在 js/advisor.js 的 observe()：每一種情況一場只講一次，而且一樣要有數字。
 * 這裡只負責「量現在的狀況」—— 使用者閒了多久、唇在畫面上佔多寬、試過幾支。
 * 主動說話很容易變成吵人，所以寧可少講：講過就不再講，使用者一動作就重新計時。
 */
function watchAR(lm, W) {
  if (S.step !== 4 || !lm || !S.skin) return;
  // 還有問題等著回答時不插別的話 —— 否則新的提示會把答案按鈕換掉，
  // 畫面上剩一個問題卻沒有能回答的按鈕，點頭搖頭也跟著失效
  if (S.yesNo) return;
  const now = performance.now();
  const lipPct = Math.abs(lm[291].x - lm[61].x) * 100;
  const ob = observe({
    idleMs: now - (S.lastAct || S.arT0 || now),
    dwellMs: now - (S.shadeT0 || now),
    curShade: tf(S.picks.lip, 'shade'), curId: S.picks.lip.id,
    tried: S.tried.size,
    lipPct,
    best: (() => { const b = bestTried(); return b ? { shade: tf(b.p, 'shade'), de: b.de } : null; })(),
    curDe: deltaE(hexToLab(S.picks.lip.color), S.skin.lab),
    said: S.said,
  });
  if (!ob) return;
  // 是非題可以用點頭／搖頭回答 —— 手勢只在這種時候聽，其他時候完全不啟用
  S.yesNo = ob.yesNo ? { yes: ob.opts[0], no: ob.opts[1] } : null;
  S.gesture = [];
  S.said.add(ob.id);
  S.lastAct = now;                       // 講完就重新計時，不要接著又講下一句
  // 問題的答案排在前面，但原本能做的事全部留著 ——
  // 被 AI 問一句就什麼都不能做，那是把對話變成關卡。
  advise4(ob.lines, false, ob.opts ? [...ob.opts, ...arOpts()] : null);
}

/**
 * 唇部放大檢視。
 * 色號之間在唇上的差別本來就不大（量測台實測有貨色號彼此最多 ΔE 7），
 * 在一個小鏡面裡更難判斷。放大只是把同樣的像素放大 —— **不動顏色**，
 * 否則就變成另一種失真。
 */
const ZOOM_LIPS = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185];
function drawLipZoom(ctx, lm, W, H) {
  const P = toPixels(lm, W, H);
  const xs = ZOOM_LIPS.map((i) => P[i].x), ys = ZOOM_LIPS.map((i) => P[i].y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = (x1 - x0) * 0.22;
  const sx = Math.max(0, x0 - pad), sy = Math.max(0, y0 - pad);
  const sw = Math.min(W - sx, (x1 - x0) + pad * 2), sh = Math.min(H - sy, (y1 - y0) + pad * 2);
  if (sw < 8 || sh < 8) return;
  const dw = W * 0.40, dh = dw * sh / sw, dx = W - dw - 12, dy = (H - dh) / 2;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(dx, dy, dw, dh, 10); ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(ctx.canvas, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(dx, dy, dw, dh, 10); ctx.stroke();
}

/** 卡片上的一句話：這款襯你的臉型就講臉型，不然講顏色，都沒有就用妝容本身的介紹 */
function cardWhy(look, why) {
  const r = faceReasonFor(S.face, look.id);
  if (r) return t('look.cardFace', { shape: t('face.' + r.shape) });
  return why[0] ? t(why[0]) : tf(look, 'desc');
}

/** 從對話裡換妝容時，卡片的選取狀態也要跟著換 */
function markLookCard() {
  const box = $('#looks'); if (!box) return;
  for (const b of box.children) b.classList.toggle('on', b.dataset.look === S.look?.id);
  const pick = $('#actions')?.lastChild; if (pick) pick.disabled = !S.look;
}

/** 推薦畫面：膚色量到什麼，以及選定的妝容跟膚色合到什麼程度 */
function advise2(fresh = false) {
  const opts = s2Opts();
  const lookLines = S.look ? [...plainLook(S.ranked, S.look, S.face, S.skin), ...plainCeleb(S.face, S.audience)] : [];
  // 換妝容時接著講就好；整段重建會讓臉型、膚色那幾句一直重新出現，像在鬼打牆
  if (fresh || !S.chat.s2?.msgs?.length) {
    if (!S.q2 && S.asked2.size === 0) S.q2 = nextQuestion2();
    $('#s2').dataset.phase = S.q2 ? 'ask' : 'suggest';
    // 拍完照先問，不先講分析 —— 知道今天的狀況，建議才給得準
    chatReset('s2', [{ kind: 'fact', key: 'adv.hi.s2', params: {} },
                     ...(S.q2 ? S.q2.lines : [...suggest2(), ...lookLines])],
              s2Opts());
  } else {
    chatReplace('s2', ['adv.p.lookFace', 'adv.p.lookSkin', 'adv.p.lookMen', 'adv.p.lookAlt', 'adv.p.celeb', 'adv.p.celebMen'], lookLines, opts);
  }
}

/**
 * 在照片上把臉型量的那幾條線畫出來：臉長（髮際到下巴）、額頭寬、臉寬、下顎寬。
 * 講「臉長大約是臉寬的 1.58 倍」的時候，使用者要看得到量的是哪裡。
 */
function drawFaceLines(ctx) {
  const L = S.faceF?.lines; if (!L) return;
  const s = Math.max(1.5, ctx.canvas.width / 360);
  ctx.save();
  ctx.lineWidth = 2 * s; ctx.strokeStyle = 'rgba(255,255,255,.92)';
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 3 * s;
  ctx.setLineDash([6 * s, 4 * s]);
  const seg = (p, q) => { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); };
  seg(L.head, L.chin);
  ctx.setLineDash([]);
  for (const k of ['temple', 'cheek', 'jaw']) seg(L[k][0], L[k][1]);
  ctx.fillStyle = S.hair?.found ? '#ffffff' : '#ffd27a';     // 估出來的髮際線用黃色，一眼分得出來
  ctx.beginPath(); ctx.arc(L.head.x, L.head.y, 4 * s, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ── 情境：心情 / 天氣 / 行程 ──────────────────────────────
// 這三項是使用者「告訴我們的」，不是量出來的。所以理由分開標示，
// 也不動膚色契合的分數 —— 原因見 js/context.js 開頭。
const CTX_GROUPS = [['mood', MOODS], ['weather', WEATHERS], ['plan', PLANS]];

/**
 * 依目前情境重新挑商品與濃度。
 * 膚色契合仍然由 resolveLook 依「量測到的底調」決定 ——
 * 情境只改「偏好的質地」與濃度，不去動誰配得上這個人的膚色。
 */
function applyContext() {
  const adv = contextAdvice(S.ctx);
  const look = Object.keys(adv.finish).length
    ? { ...S.look, prefer: { ...S.look.prefer, ...adv.finish } }
    : S.look;
  S.picks = resolveLook(look, S.skin.undertone, seasonFit());
  S.amount = adjustIntensity(S.look.intensity, adv.amount);
  // 第一次化妝的人整體再輕一點：太濃第一眼就會嚇到，想要更明顯隨時可以往上調
  if (S.level === 'new') for (const k of ['lip', 'eye', 'cheek']) S.amount[k] = +(S.amount[k] * 0.85).toFixed(3);
  return adv;
}

function mountContext() {
  const box = $('#ctx'); if (!box) return;     // 情境改由 AI 在對話裡問，畫面上不再放按鈕面板
  box.innerHTML = '';
  for (const [kind, ids] of CTX_GROUPS) {
    const row = el('div', 'ctx-row');
    row.appendChild(el('span', 'lab', t('ctx.' + kind)));
    for (const id of ids) {
      const b = el('button', S.ctx[kind] === id ? 'on' : '', t('ctx.' + kind + '.' + id));
      // 再按一次取消 —— 不想說的就不用說，沒選的項目完全不影響推薦
      b.onclick = () => { S.ctx[kind] = S.ctx[kind] === id ? null : id; refreshContext(); };
      row.appendChild(b);
    }
    if (kind === 'mood' && S.ctxAuto) row.appendChild(el('span', 'auto', t('ctx.auto')));
    if (kind === 'weather' && S.ctxFeed) row.appendChild(el('span', 'auto', t('ctx.feed')));
    box.appendChild(row);
  }

  const adv = contextAdvice(S.ctx);
  box.appendChild(el('div', 'tip', adv.any
    ? t('ctx.applied') + '　' + adv.reasons.map((r) => t(r.key)).join('　·　')
    : t('ctx.none')));
  box.appendChild(el('div', 'tip', t('ctx.note')));

  // 情境加權後如果另一款妝容更合，給一個「換過去」的建議 —— 但不自動換掉他選的
  const top = rankWithContext(S.ranked, adv)[0];
  if (adv.any && top && top.look.id !== S.look?.id && top.ctxBonus > 0) {
    const b = el('button', 'ctx-swap', t('ctx.swap', { look: tf(top.look, 'name') }));
    b.onclick = () => { S.look = top.look; refreshContext(); };
    box.appendChild(b);
  }
}

/** 情境改變 → 重新挑商品、重畫配方與預覽 */
function refreshContext() {
  applyContext(); mountContext(); renderStep3();
  chatReset('s3', [...onPicks(S.picks, S.skin), ...S.advShade], optsForPicks(S.picks, S.skin, S.pref));
}

function enter3() {
  mountContext();
  renderStep3();
  if (S.amount0 == null) S.amount0 = S.amount.lip;    // 收尾要講「你自己調了多少」
  // 對話只在「進入這個畫面」時重建 —— 重畫商品不該把對話紀錄洗掉
  // 第一次進來時 AI 反問一題：答案會真的改變濃度，所以值得問。
  const q = nextQuestion();
  const base = optsForPicks(S.picks, S.skin, S.pref);
  chatReset('s3', [...onPicks(S.picks, S.skin), ...levelTip(S.level, 's3'), ...S.advShade, ...prefRecall(S.pref, S.picks), ...(q ? q.lines : [])],
            q ? [...q.opts, ...base] : base);
  setActions([
    { label: t('btn.changeLook'), cls: 'ghost', on: () => go(2) },
    // 照片試妝只在沒有鏡頭時出現：看完就去商品推薦
    S.stream ? { label: t('btn.startAR'), cls: 'primary', on: () => go(4) }
             : { label: t('btn.finish'), cls: 'primary', on: () => go(5) },
  ]);
}

function renderStep3() {
  // 上妝預覽：每次進來（含換色號、換情境）都重播一次掃掠
  cancelAnimationFrame(prevRAF);
  startApply();
  (function frame() {
    const ph = applyPhase();
    paintPreview(ph.k, ph.sweep);
    if (ph.sweep >= 0) prevRAF = requestAnimationFrame(frame);
  })();

  const box = $('#items'); box.innerHTML = '';
  for (const cat of ['lip', 'eye', 'cheek']) {
    const p = S.picks[cat];
    const row = el('div', 'item');
    row.innerHTML =
      swatchHTML(p, 'sw') +
      `<div><div class="n">${p.brand} ${tf(p, 'name')}</div>
            <div class="s">${catLabel(cat)} · ${tf(p, 'shade')} · ${finishLabel(p.finish)}</div>
            <div class="tagline">${p._reason.filter((r) => r[0] !== 'reason.lowStock')
                                            .map(trReason).join('　·　')}</div></div>`;
    box.appendChild(row);
  }
  box.appendChild(el('div', 'note', t('s3.note')));

  S.tried.add(S.picks.lip.id);
  paintPanel();
}

// refL 給遮擋拒斥當亮度基準 —— 用 Step 2 量到的膚色明度，
// 深膚色才不會被固定門檻誤判成「遮擋物」。
// ── WebGL 上妝層的參數 ──────────────────────────────────
// 質地 → bias（加性補光）：霧面沒有反光，水光與珠光才有。
// 舊的 2D 版只有乘性，所以珠光在數學上就畫不出來。
const BIAS = { matte: 0, gloss: 24, shimmer: 40 };

function glCfgFor(p, amount, look) {
  if (!p) return { lip: null, shadow: null, blush: null };
  return {
    lip: p.lip && amount.lip > 0 ? {
      on: true, color: disp(p.lip.color),
      alpha: Math.round(amount.lip * COVERAGE.lip[p.lip.finish] * 100),   // 覆蓋率由質地決定
      grad: look?.lipGradient ? 55 : 0,          // 韓系漸層唇
      soft: 15, bias: BIAS[p.lip.finish] ?? 12, finish: p.lip.finish,
    } : null,
    shadow: p.eye && amount.eye > 0 ? {
      on: true, color: disp(p.eye.color),
      alpha: Math.round(amount.eye * COVERAGE.eye[p.eye.finish] * 100),
      extent: 62, grad: 78, soft: 40, bias: BIAS[p.eye.finish] ?? 18, finish: p.eye.finish,
    } : null,
    blush: p.cheek && amount.cheek > 0 ? {
      on: true, color: disp(p.cheek.color),
      alpha: Math.round(amount.cheek * COVERAGE.cheek[p.cheek.finish] * 100),
      radius: 55, pos: 22, core: 15, bias: BIAS[p.cheek.finish] ?? 10, finish: p.cheek.finish,
    } : null,
  };
}
const glCfg = () => glCfgFor(S.picks, S.amount, S.look);

// 每次 setMakeup 都會重建兩張 1024² 貼圖，不能每幀都做。
// 用參數簽章比對，只有真的變了才重建。
let lastSig = '';
function syncMakeup() {
  // 手動模式把自動上妝關掉 —— 臉先是素的，妝才是「自己畫上去的」。
  // 切回其他模式時 glCfg() 會原樣回來，手繪層則獨立保留。
  const c = S.tab === 'paint' ? { lip: null, shadow: null, blush: null } : glCfg();
  const sig = JSON.stringify(c);
  if (sig !== lastSig) { setMakeup(c); lastSig = sig; }
  return c;
}

/**
 * 第二層（雙色模式的右半邊）。
 * setMakeupB 會重畫兩張 1024² 貼圖，跟第一層一樣要靠簽章擋掉每幀重建 ——
 * 少了這道，雙色模式的幀率會直接掉一半。
 */
let lastSigB = 'init';
function syncMakeupB() {
  const c = S.mode === 'dual' && S.pickB
    ? glCfgFor({ ...S.picks, lip: S.pickB }, S.amount, S.look)
    : null;
  const sig = JSON.stringify(c);
  if (sig !== lastSigB) { setMakeupB(c); lastSigB = sig; }
}

/** 把正規化關鍵點轉成 WebGL 需要的像素座標（只需前 468 點） */
const toPixels = (lm, W, H) => {
  const out = new Array(468);
  for (let i = 0; i < 468; i++) out[i] = { x: lm[i].x * W, y: lm[i].y * H };
  return out;
};

/**
 * Step 2 的妝容縮圖：把使用者自己的臉裁切出來，直接套上該妝容渲染。
 * 之前這裡是 CSS 畫的抽象小臉 —— 看不出妝容差別，等於沒有預覽。
 * 現在用同一支 GL 渲染器，所見即 Step 4 會看到的東西。
 */
function lookThumb(look, w, h) {
  const c = el('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!S.photo || !S.photoLm) return null;

  const PW = S.photo.width, PH = S.photo.height;
  const xs = S.photoLm.map((p) => p.x * PW), ys = S.photoLm.map((p) => p.y * PH);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);

  // 以臉框為準、外擴留白，再裁成縮圖的長寬比（不能拉伸，否則妝會歪）
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const fw = (x1 - x0) * 1.45, fh = (y1 - y0) * 1.30;
  const ar = w / h;
  let sw = fw, sh = fh;
  if (sw / sh > ar) sh = sw / ar; else sw = sh * ar;
  const sx = cx - sw / 2, sy = cy - sh / 2;

  ctx.drawImage(S.photo, sx, sy, sw, sh, 0, 0, w, h);

  const P = new Array(468);
  for (let i = 0; i < 468; i++) {
    P[i] = { x: (S.photoLm[i].x * PW - sx) / sw * w, y: (S.photoLm[i].y * PH - sy) / sh * h };
  }

  const picks = resolveLook(look, S.skin.undertone, seasonFit());
  setMakeup(glCfgFor(picks, look.intensity, look));
  setSplit(-1);
  setIntensity(100); setSweep(-1); useBrush(false);
  resetRefs();   // 在照片上渲染：唇與皮膚的亮度基準要從這張圖重新量
  const ok = renderGL(ctx, P, w, h);
  lastSig = '';          // 縮圖動過貼圖，讓主流程下次一定重建
  return ok ? c : null;
}

const cfg = () => ({
  refL: S.skin?.lab.L,
  lip:   { color: disp(S.picks.lip.color),   finish: S.picks.lip.finish,   amount: S.amount.lip,
           gradient: !!S.look?.lipGradient },
  eye:   { color: disp(S.picks.eye.color),   finish: S.picks.eye.finish,   amount: S.amount.eye },
  cheek: { color: disp(S.picks.cheek.color), finish: S.picks.cheek.finish, amount: S.amount.cheek },
});

// ═══════════════ 右側商品卡 ═══════════════
/** 質地色塊：霧面 / 水光 / 珠光在 CSS 裡有不同表現 */
const swatchHTML = (p, extra = '') =>
  `<i class="fin ${p.finish} ${extra}" style="--c:${disp(p.color)}"></i>`;

// ── 真實商品照 ──────────────────────────────────────────
// 把去背圖丟進 products/ 並用商品 id 命名（L204.png / E01.webp …），
// 畫面就會自動改用照片；沒有照片時退回下面用 CSS 畫的版本。
// 不需要改任何程式碼，也不會因為缺圖而開天窗。
let photoIndex = null;

async function findProductImage(p) {
  if (p.image) return p.image;              // products.js 明確指定的路徑優先
  const embedded = globalThis.__LUCID_IMAGES__?.[p.id];
  if (embedded) return embedded;            // 單檔版：照片已內嵌成 data URI
  // 單檔版沒有伺服器可問索引；file:// 下 fetch 相對路徑一定失敗，
  // 直接跳過，讓它退回 CSS 畫的商品圖，而不是在 console 噴錯。
  if (globalThis.__LUCID_SINGLEFILE__) return null;
  photoIndex ??= fetch('images/products/index.json')
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const files = await photoIndex;
  const hit = files.find((f) => f.replace(/\.[^.]+$/, '') === p.id);
  return hit ? `images/products/${hit}` : null;
}

/** 先畫 CSS 版（不留空白），照片載到了再換掉 */
async function mountProduct(box, p) {
  box.dataset.pid = p.id;
  box.innerHTML = productHTML(p);
  const url = await findProductImage(p);
  if (url && box.dataset.pid === p.id) {
    box.innerHTML = `<img class="pimg" src="${url}" alt="${p.brand} ${p.shade}">`;
  }
}

/** 商品實體，純 CSS 畫的，不用去背圖 */
function productHTML(p) {
  if (p.cat === 'lip')
    return `<div class="obj lipstick" style="--c:${disp(p.color)}">
              <i class="bullet"></i><i class="ring"></i><i class="tube"></i></div>`;
  if (p.cat === 'eye') {
    // 四格用同一支商品的色值推派出深淺，色相不變
    const pans = [
      `color-mix(in oklab, ${p.color} 45%, white)`,
      `color-mix(in oklab, ${p.color} 78%, white)`,
      p.color,
      `color-mix(in oklab, ${p.color} 68%, black)`,
    ];
    return `<div class="obj palette">${pans.map((c) =>
      `<i class="fin ${p.finish}" style="--c:${c}"></i>`).join('')}</div>`;
  }
  return `<div class="obj compact"><i class="fin ${p.finish}" style="--c:${p.color}"></i></div>`;
}

function paintPanel() {
  const p = S.picks.lip;
  // 購物資訊只在最後一步出現。前面幾步要讓人專心在「好不好看」，
  // 一旦看到價格，注意力就會從妝跑到錢上面。
  const shopping = S.step === 5;
  $('#panel-cap').textContent = t(shopping ? 'panel.featured' : 'panel.tryon');
  $('#spec-stock').hidden = $('#spec-price').hidden = !shopping;
  $('#bag').hidden = !shopping;
  $('#p-name').innerHTML = `${p.brand} <em>${tf(p, 'name')}</em>`;
  mountProduct($('#hero'), p);
  $('#p-finish').textContent = finishLabel(p.finish);
  $('#p-shade').textContent = tf(p, 'shade');
  $('#p-stock').textContent = p.stock > 0 ? t('stock.n', { n: p.stock }) : t('stock.out');
  $('#p-price').textContent = `$${p.price}`;

  const sw = $('#swatches'); sw.innerHTML = '';
  const recId = resolveLook(S.look, S.skin.undertone, seasonFit()).lip.id;
  for (const q of PRODUCTS.filter((x) => x.cat === 'lip')) {
    const b = el('button', 'sw-btn' + (q.id === p.id ? ' on' : '') + (q.id === recId ? ' rec' : '') + (q.stock <= 0 ? ' oos' : ''));
    b.innerHTML = swatchHTML(q) + (tf(q, 'shade').split(' ').slice(1).join(' ') || tf(q, 'shade'));
    b.dataset.rec = t('sw.rec');
    b.title = q.stock <= 0 ? `${tf(q, 'shade')}｜${t('stock.out')}`
      : shopping ? `${tf(q, 'shade')}｜${finishLabel(q.finish)}｜$${q.price}`
      : `${tf(q, 'shade')}｜${finishLabel(q.finish)}`;
    b.onclick = () => {
      if (q.stock <= 0) { flash(t('bag.oosTry'), true); return; }
      S.advShade = onShadeChange(q, S.picks.lip, S.skin);   // 換色號 → 顧問回應這一支跟底調的關係
      S.lastAct = performance.now();
      switchLip(q);      // 換之前先把「在上一支停了多久」記進偏好
      paintPanel();
      startApply();      // 換了色號就重播一次上妝，換色這件事才看得見
      if (S.step === 3) enter3();
      else if (S.step === 5) paintReport();
      else updateCallout();
    };
    sw.appendChild(b);
  }

  $('#bag').onclick = () => {
    if (p.stock <= 0) return flash(t('bag.oos'), true);
    S.bag.push(p.id);
    flash(t('bag.msg', { shade: tf(p, 'shade'), n: S.bag.length }));
  };
  $('#bagmsg').textContent = '';
}
function flash(msg, bad) {
  const n = $('#bagmsg');
  n.textContent = msg;
  n.style.color = bad ? '#fbbf24' : 'var(--ok)';
  clearTimeout(flash.t); flash.t = setTimeout(() => (n.textContent = ''), 2600);
}

// ═══════════════ STEP 4 · 即時 AR ═══════════════
function enter4() {
  mountVideo($('#s4 .frame'));
  paintPanel();
  updateCallout();

  // BEFORE 縮圖
  const bc = $('#before-c');
  bc.width = S.photo.width; bc.height = S.photo.height;
  bc.getContext('2d').drawImage(S.photo, 0, 0);
  $('#before').hidden = S.mode !== 'full';

  mountLooks();
  mountTabs();
  mountModes();
  mountPanel();
  mountHistory();
  mountSheet();

  $('#zoom-btn').onclick = () => { S.zoom = !S.zoom; mountZoomBtn(); syncAROpts(); };
  $('#paint-btn').onclick = () => enterPaint();
  $('#paint-btn').textContent = t('paint.btn');
  $('#s4').classList.remove('painting-mode'); $('#paintbar').hidden = true;
  mountZoomBtn();
  advise4([...onAR({ ...S.picks.lip, shade: tf(S.picks.lip, 'shade') }, S.amount.lip), ...levelTip(S.level, 's4')], true);
  bindMirror($('#s4 .frame'));
  // ?debug 時把筆刷內部狀態掛出來 —— 現場要判斷「畫不上去」是筆觸沒進去，
  // 還是畫進去了但沒重繪，只靠看畫面分不出來。
  if (DEBUG) globalThis.__LUCID_AR__ = { hasBrush, screenToUV, clearBrush, renderGL, toPixels, syncMakeup, lm: () => smooth,
                                         pressureLevel, applyPressure, press: () => ({ seen: pressSeen, sens: S.brush.press }),
                                         markFace, drawMark, tapRegion, feedGesture,
                                         watchAR, faceInfo, skin: () => S.skin, chart: () => S.chartFit, face: () => ({ hair: S.hair, f: S.faceF, cls: S.face }),
                                         yesNo: () => S.yesNo, gest: () => S.gesture };
  resetRefs();                     // 回到即時畫面：亮度基準改從鏡頭重新量
  startApply();
  S.arT0 = performance.now();
  S.lastAct = S.shadeT0 = S.arT0;
  if (S.amount0 == null) S.amount0 = S.amount.lip;

  setActions([
    { label: t('btn.changeLook'), cls: 'ghost', on: () => go(2) },
    { label: t('btn.finish'), cls: 'primary', on: () => go(5) },
  ]);

  arLoop();
}

/**
 * 三段模式。放在鏡面正下方而不是操作列 —— 這是「看著自己調」的東西，
 * 手要留在畫面附近，不該跑到最下面去按。
 */
/* ══ Step 4 的操作區：參考輕顏相機與美圖秀秀的組織方式 ══════
   兩支 app 的共同做法，套到櫃位機台上仍然成立：

   1. 妝容是**一排圓形膠囊**，縮圖是你自己的臉，點一下整組換掉。
      不是選單、不是清單 —— 選妝容這件事是用看的，不是用讀的。
   2. 細調是**分頁**（唇 / 眼 / 頰），一次只出現一組色號加一條滑桿。
      三條滑桿同時攤開會讓人不知道先動哪一條。
   3. 對比之類的檢視開關**浮在畫面上**，不佔下方空間。

   刻意沒有照抄的：它們的重點是磨皮瘦臉與濾鏡，這台機器的重點是
   「這支色號在你臉上是什麼樣子、多少錢、櫃上還有沒有貨」。
   所以顏色一律來自實際商品，不做任何美化臉型的處理。            */

const MODES = [['full', 'mode.full'], ['bare', 'mode.bare'], ['dual', 'mode.dual']];
const TABS = [['lip', 'sl.lip'], ['eye', 'sl.eye'], ['cheek', 'sl.cheek'], ['paint', 'mode.paint']];

/** 對比模式：浮在鏡面左上角。手動上妝時不出現 —— 分界線會把畫的東西切掉一半。 */
function mountModes() {
  const box = $('#s4-mode');
  box.hidden = S.tab === 'paint';
  if (box.hidden) { if (S.mode !== 'full') { S.mode = 'full'; $('#before').hidden = false; } return; }
  box.innerHTML = '';
  for (const [id, key] of MODES) {
    const b = el('button', S.mode === id ? 'on' : '', t(key));
    b.onclick = () => {
      S.mode = id;
      S.splitOff = 0;          // 每次切進對比模式，分界線都從臉的中線出發
      if (id === 'dual' && !S.pickB) S.pickB = altShade();
      $('#before').hidden = id !== 'full';
      startApply();
      mountModes(); mountPanel(); syncAROpts();
    };
    box.appendChild(b);
  }
}

/* ══ 撤銷 / 重做 ═══════════════════════════════════════
   美圖秀秀是編輯器，最上面永遠有一對「撤銷／重做」。這台機器少了它 ——
   使用者一路點色號、拉濃度、手繪，弄壞了只能整個重來。

   兩種步驟混在同一個堆疊裡：
     state  —— 換色號、拉濃度、換妝容：存前後兩份小快照
     stroke —— 手繪的一筆：交給渲染器自己的筆觸堆疊處理
   混在一起是刻意的：使用者心裡只有「上一步」，不會分那是哪一類操作。 */

const snapshot = () => JSON.stringify({
  picks: ['lip', 'eye', 'cheek'].map((k) => S.picks[k].id),
  amount: S.amount, pickB: S.pickB?.id ?? null, look: S.look?.id ?? null,
});

function restore(json) {
  const v = JSON.parse(json);
  ['lip', 'eye', 'cheek'].forEach((k, i) => {
    const p = PRODUCTS.find((x) => x.id === v.picks[i]);
    if (p) S.picks[k] = { ...p, _reason: S.picks[k]._reason, _alts: S.picks[k]._alts };
  });
  S.amount = { ...v.amount };
  S.pickB = v.pickB ? PRODUCTS.find((x) => x.id === v.pickB) : null;
  if (v.look) S.look = LOOKS.find((x) => x.id === v.look) || S.look;
  paintPanel(); updateCallout();
  mountLooks(); mountTabs(); mountPanel();
}

/** 包住一個會改動狀態的操作，前後各拍一張 */
function step(fn) {
  const before = snapshot();
  fn();
  const after = snapshot();
  if (before === after) return;
  S.hist.push({ type: 'state', before, after });
  S.redo.length = 0;
  mountHistory();
}

function pushStroke() {
  S.hist.push({ type: 'stroke' }); S.redo.length = 0; mountHistory();
  if (S.paintTip) { S.paintTip = false; mountPaintbar(); }
}

function undo() {
  const h = S.hist.pop();
  if (!h) return;
  if (h.type === 'stroke') { undoStroke(); lastSig = ''; }
  else restore(h.before);
  S.redo.push(h);
  mountHistory();
}

function redoOne() {
  const h = S.redo.pop();
  if (!h) return;
  if (h.type === 'stroke') { redoStroke(); lastSig = ''; }
  else restore(h.after);
  S.hist.push(h);
  mountHistory();
}

function mountHistory() {
  const box = $('#s4-hist'); box.innerHTML = '';
  for (const [key, act, on] of [['hist.undo', undo, S.hist.length], ['hist.redo', redoOne, S.redo.length]]) {
    const b = el('button', '', t(key));
    b.disabled = !on;
    b.onclick = act;
    box.appendChild(b);
  }
}

/** 妝容膠囊列。第一顆是「不上妝」，跟輕顏濾鏡列開頭的「无」同一個作用。 */
function mountLooks() {
  const box = $('#s4-looks'); box.innerHTML = '';

  const none = el('button', 'cap' + (S.amount.lip + S.amount.eye + S.amount.cheek === 0 ? ' on' : ''));
  none.innerHTML = `<i class="bare"></i><span>${t('look.none')}</span>`;
  none.onclick = () => step(() => {
    S.amount = { lip: 0, eye: 0, cheek: 0 };
    mountLooks(); mountPanel();
  });
  box.appendChild(none);

  for (const { look } of S.ranked) {
    const on = S.look?.id === look.id && S.amount.lip > 0;
    const b = el('button', 'cap' + (on ? ' on' : ''));
    const thumb = lookThumb(look, 64, 64);
    b.appendChild(thumb || el('i', 'bare'));
    b.appendChild(el('span', '', tf(look, 'name')));
    b.onclick = () => step(() => {
      S.look = look;
      applyContext();
      S.tried.add(S.picks.lip.id);
      paintPanel(); updateCallout(); startApply();
      mountLooks(); mountPanel();
    });
    box.appendChild(b);
  }
}

/** 分頁：唇 / 眼 / 頰 / 手動上妝 */
function mountTabs() {
  const box = $('#s4-tabs'); box.innerHTML = '';
  for (const [id, key] of TABS) {
    const b = el('button', S.tab === id ? 'on' : '');
    if (id !== 'paint') b.innerHTML = `<i style="--c:${disp(S.picks[id].color)}"></i>`;
    b.appendChild(el('span', '', t(key)));
    b.onclick = () => { if (id === 'paint') return enterPaint(); if (S.tab === 'paint') exitPaint(true); S.tab = id; mountModes(); mountPanel(); };
    box.appendChild(b);
  }
}

/* ══ 自己上妝 ═══════════════════════════════════════════
   以前「手動上妝」藏在抽屜的「妝容調整」第四個分頁，而且抽屜打開時會蓋住大半個鏡子 ——
   選了也沒有臉可以畫，等於功能不見了。
   現在：鏡面上一顆「✍️ 自己畫」、AI 也會提議；進入後抽屜收起來、整面鏡子都能畫，
   工具縮成底部一條（塗在哪裡、顏色、粗細、擦掉、完成）。撤銷／重做沿用鏡面左上那一組。 */
function enterPaint() {
  if (S.step !== 4) return;
  S.tab = 'paint';
  $('#s4').classList.add('painting-mode');
  S.paintTip = true;                       // 進來時工具列上帶一句怎麼畫，畫了第一筆就收起來
  mountTabs(); mountModes(); mountPanel(); mountPaintbar(); liftMirror();
}
function exitPaint(quiet = false) {
  if (S.tab !== 'paint' && !$('#s4').classList.contains('painting-mode')) return;
  $('#s4').classList.remove('painting-mode');
  $('#paintbar').hidden = true;
  if (!quiet) {
    S.tab = 'lip';
    mountTabs(); mountModes(); mountPanel();
    // 畫完回到對話：有畫東西就肯定一下，並提醒可以撤銷；順便給一個跟剛才畫的部位有關的小技巧
    const drew = hasBrush();
    chatSay('s4', [{ kind: drew ? 'praise' : 'fact', key: drew ? 'adv.paint.done' : 'adv.paint.none', params: {} }], arOpts());
    S.sheet.state = 'open'; S.sheet.tab = 'ai';
  }
  liftMirror(); syncSheet();
}

function mountPaintbar() {
  const bar = $('#paintbar'); if (!bar) return;
  bar.hidden = false; bar.innerHTML = '';
  const row = el('div', 'pb-row');
  for (const [id, key] of BRUSH_TOOLS) {
    const b = el('button', 'pb-part' + (S.brush.tool === id ? ' on' : ''));
    b.innerHTML = `<i style="--c:${disp(S.picks[id].color)}"></i><span>${t(key)}</span>`;
    b.onclick = () => { S.brush.tool = id; mountPaintbar(); mountPanel(); };
    row.appendChild(b);
  }
  const wipe = el('button', 'pb-wipe', t('brush.clear'));
  wipe.onclick = () => {
    clearBrush(); lastSig = '';
    S.hist = S.hist.filter((h) => h.type !== 'stroke'); S.redo.length = 0;
    mountHistory();
  };
  const done = el('button', 'pb-done', t('paint.done'));
  done.onclick = () => exitPaint();
  row.append(wipe, done);
  bar.appendChild(row);

  const row2 = el('div', 'pb-row');
  const chips = el('div', 'pb-chips');
  for (const q of PRODUCTS.filter((x) => x.cat === S.brush.tool)) {
    const b = el('button', 'chip' + (q.id === S.picks[S.brush.tool].id ? ' on' : '') + (q.stock <= 0 ? ' oos' : ''));
    b.innerHTML = `<i style="--c:${disp(q.color)}"></i>`;
    b.title = tf(q, 'shade');
    b.onclick = () => {
      if (q.stock <= 0) return flash(t('bag.oosTry'), true);
      step(() => {
        S.picks[S.brush.tool] = { ...q, _reason: [['reason.manual']], _alts: [] };
        if (S.brush.tool === 'lip') { S.tried.add(q.id); paintPanel(); updateCallout(); }
        mountPaintbar(); syncSheet();
      });
    };
    chips.appendChild(b);
  }
  row2.appendChild(chips);
  // 粗細：一般手指塗唇用細一點、腮紅用粗一點 —— 工具列上只留這一條，其他參數在「妝容調整」裡
  const size = el('label', 'pb-size');
  size.innerHTML = `<span>${t('brush.size')}</span><input type="range" min="10" max="80" value="${S.brush.size}">`;
  size.querySelector('input').oninput = (e) => { S.brush.size = +e.target.value; };
  row2.appendChild(size);
  bar.appendChild(row2);
  if (S.paintTip) bar.appendChild(el('div', 'pb-tip', t('paint.tip.' + S.brush.tool)));
}

/** 一條滑桿。數值跟著滑桿走，不必去對照最右邊的數字。 */
function slider(labelKey, get, set, track = true) {
  const r = el('div', 'sl');
  r.innerHTML = `<label>${t(labelKey)}</label>
    <input type="range" min="0" max="100" value="${get()}">
    <output>${get()}</output>`;
  const inp = r.querySelector('input'), out = r.querySelector('output');
  // 拖曳中每一格都記一步的話，撤銷會變成一格一格倒退 —— 放開才算一步
  let before = null;
  inp.oninput = () => {
    if (track && before === null) before = snapshot();
    set(+inp.value); out.textContent = inp.value;
  };
  inp.onchange = () => {
    if (!track || before === null) return;
    const after = snapshot();
    if (before !== after) { S.hist.push({ type: 'state', before, after }); S.redo.length = 0; mountHistory(); }
    before = null;
  };
  return r;
}

/** 目前分頁的內容：色號列 + 濃度，或是刷具 */
function mountPanel() {
  const box = $('#s4-panel'); box.innerHTML = '';
  if (S.tab === 'paint') return mountBrushPanel(box);

  const cat = S.tab;
  // 雙色只做在唇上 —— 眼影腮紅分左右看不出所以然，只會讓人以為壞了
  if (cat === 'lip' && S.mode === 'dual') {
    const tabs = el('div', 'sides');
    for (const [id, key] of [['a', 'side.left'], ['b', 'side.right']]) {
      const p = id === 'a' ? S.picks.lip : S.pickB;
      const b = el('button', S.side === id ? 'on' : '');
      b.innerHTML = `<i style="--c:${disp(p?.color || '#ccc')}"></i>` +
                    `<span>${t(key)}</span><b>${p ? tf(p, 'shade') : '—'}</b>`;
      b.onclick = () => { S.side = id; mountPanel(); };
      tabs.appendChild(b);
    }
    box.appendChild(tabs);
  }

  // 質地篩選：美圖秀秀的口紅面板就是先選霧面／水光／珠光，再挑色號。
  // 「我只要霧面」是買東西時真的會有的條件，這裡剛好對得上商品的 finish 欄位。
  const FIN = ['all', 'matte', 'gloss', 'shimmer'];
  const inCat = PRODUCTS.filter((x) => x.cat === cat);
  const fins = el('div', 'fins');
  for (const f of FIN) {
    const n = f === 'all' ? inCat.length : inCat.filter((x) => x.finish === f).length;
    if (!n) continue;
    const b = el('button', S.finish === f ? 'on' : '', f === 'all' ? t('fin.all') : finishLabel(f));
    b.onclick = () => { S.finish = f; mountPanel(); };
    fins.appendChild(b);
  }
  if (fins.children.length > 2) box.appendChild(fins);

  const dualB = cat === 'lip' && S.mode === 'dual' && S.side === 'b';
  const active = dualB ? S.pickB : S.picks[cat];
  const strip = el('div', 'strip');
  const shown = inCat.filter((x) => S.finish === 'all' || x.finish === S.finish);
  for (const q of shown) {
    const b = el('button', 'chip' + (q.id === active?.id ? ' on' : '') + (q.stock <= 0 ? ' oos' : ''));
    b.innerHTML = `<i style="--c:${disp(q.color)}"></i>`;
    b.title = `${tf(q, 'shade')}｜${finishLabel(q.finish)}`;
    b.onclick = () => {
      if (q.stock <= 0) return flash(t('bag.oosTry'), true);
      step(() => {
        if (dualB) S.pickB = q;
        else {
          advise4([...onShadeChange(q, S.picks[cat], S.skin),  // 換色號 → 當場回應，跟行程差很多再提一個方向
                   ...(cat === 'lip' ? [...shadeHint(q, PRODUCTS.filter((p) => p.cat === 'lip'), S.ctx, S.level),
                                        ...seasonShadeLine(q, S.season, PRODUCTS.filter((p) => p.cat === 'lip'))] : [])]);
        S.picks[cat] = { ...q, _reason: [['reason.manual']], _alts: [] };
          if (cat === 'lip') { S.tried.add(q.id); paintPanel(); updateCallout(); }
        }
        if (S.amount[cat] === 0) S.amount[cat] = S.look?.intensity[cat] ?? 0.6;   // 濃度是 0 的話換色號看不出差別
        startApply();
        mountLooks(); mountPanel();
      });
    };
    strip.appendChild(b);
  }
  box.appendChild(strip);

  box.appendChild(el('div', 'shade-name', active ? `${tf(active, 'shade')}　·　${finishLabel(active.finish)}` : '—'));
  box.appendChild(slider('sl.amount',
    () => Math.round(S.amount[cat] * 100),
    (v) => { S.amount[cat] = v / 100; hintSoon(cat); }));
}

/**
 * 虛擬刷具。筆觸畫在 UV 空間，所以妝是「畫在臉上」而不是「畫在畫面上」——
 * 畫完把頭轉過去，妝跟著轉。這是整個手動上妝能不能成立的分水嶺。
 */
const BRUSH_TOOLS = [['lip', 'sl.lip'], ['eye', 'sl.eye'], ['cheek', 'sl.cheek']];

function mountBrushPanel(box) {
  const row = el('div', 'tools');
  // 上面的部位分頁跟這一列字面一模一樣，差別只在語意：
  // 那一排是「現在調哪個部位」，這一排是「筆刷塗在哪個部位」。
  // 不標出來的話畫面上就是同一排東西重複了兩次。
  row.appendChild(el('span', 'rowlab', t('brush.on')));
  for (const [id, key] of BRUSH_TOOLS) {
    const b = el('button', S.brush.tool === id ? 'on' : '');
    b.innerHTML = `<i style="--c:${disp(S.picks[id].color)}"></i><span>${t(key)}</span>`;
    b.onclick = () => { S.brush.tool = id; mountPanel(); };
    row.appendChild(b);
  }
  const wipe = el('button', 'wipe', t('brush.clear'));
  wipe.onclick = () => {
    clearBrush(); lastSig = '';
    S.hist = S.hist.filter((h) => h.type !== 'stroke'); S.redo.length = 0;   // 筆觸都沒了，相關步驟也不該還能撤銷
    mountHistory();
  };
  row.appendChild(wipe);
  box.appendChild(row);

  const strip = el('div', 'strip');
  for (const q of PRODUCTS.filter((x) => x.cat === S.brush.tool)) {
    const b = el('button', 'chip' + (q.id === S.picks[S.brush.tool].id ? ' on' : '') + (q.stock <= 0 ? ' oos' : ''));
    b.innerHTML = `<i style="--c:${disp(q.color)}"></i>`;
    b.title = tf(q, 'shade');
    b.onclick = () => {
      if (q.stock <= 0) return flash(t('bag.oosTry'), true);
      step(() => {
        S.picks[S.brush.tool] = { ...q, _reason: [['reason.manual']], _alts: [] };
        if (S.brush.tool === 'lip') { S.tried.add(q.id); paintPanel(); updateCallout(); }
        mountPanel();
      });
    };
    strip.appendChild(b);
  }
  box.appendChild(strip);
  // 筆刷參數不進歷程：它是「工具設定」，不是「做過的事」
  box.appendChild(slider('brush.size', () => S.brush.size, (v) => (S.brush.size = v), false));
  box.appendChild(slider('brush.flow', () => S.brush.flow, (v) => (S.brush.flow = v), false));
  // 筆壓靈敏度。拉到 0 就完全等於沒有筆壓這回事 —— 一般觸控螢幕的機台
  // 本來就量不到壓力，留一個「關得掉」的開關比硬套一條曲線誠實。
  box.appendChild(slider('brush.press', () => S.brush.press, (v) => (S.brush.press = v), false));
  box.appendChild(el('div', 'tip', t('brush.tip')));
  if (noPressNoted && !pressSeen) box.appendChild(el('div', 'tip warn', t('brush.noPress')));
}

/** 雙色模式預設的另一支：跟目前這支色差最大、且有貨的唇色 */
function altShade() {
  const cur = hexToLab(S.picks.lip.color);
  return PRODUCTS.filter((p) => p.cat === 'lip' && p.stock > 0 && p.id !== S.picks.lip.id)
    .sort((a, b) => deltaE(hexToLab(b.color), cur) - deltaE(hexToLab(a.color), cur))[0] || null;
}

// 這台裝置到底回不回報筆壓，是「量出來的」不是「猜的」——
// 面板上的說明要照實寫，不能讓人以為筆壓沒作用是自己壓得不夠用力。
let pressSeen = false, noPressNoted = false;

/**
 * 這一點的筆壓，順便判定裝置支不支援。
 *
 * 為什麼不能直接用 e.pressure：
 *   - 滑鼠按下去固定回 0.5，那是「未知」不是「半力」。
 *   - 一般電容式觸控螢幕同樣固定回 0.5 或 1，沒有壓力感應。
 *   - 只有觸控筆（pointerType 'pen'）與力度觸控螢幕會回真正變動的值。
 * 所以 pen 直接相信；其他型別要先真的看到「不是 0 也不是 0.5」的值，
 * 才承認這台裝置有筆壓。在那之前一律滿壓 —— 寧可沒有筆壓，
 * 也不要讓所有人的妝莫名其妙淡一半。
 */
function strokePressure(e) {
  const raw = e.pressure;
  if (raw > 0 && Math.abs(raw - 0.5) > 1e-6) pressSeen = true;
  const usable = e.pointerType === 'pen' || (e.pointerType !== 'mouse' && pressSeen);
  return pressureLevel(usable ? raw : 0, S.brush.press / 100);
}

/** 一筆的參數：顏色來自目前選中的商品，質地決定要不要帶加性打亮 */
function brushOpts() {
  const p = S.picks[S.brush.tool];
  const R = { lip: 26, eye: 30, cheek: 46 }[S.brush.tool];      // 各部位的基準半徑
  return {
    color: disp(p.color),
    alpha: (S.brush.flow / 100) * 0.16,      // 壓低，靠反覆塗抹堆疊
    radius: (S.brush.size / 100) * R + R * 0.35,
    bias: BIAS[p.finish] ?? 10,
    finish: p.finish, lip: S.brush.tool === 'lip',   // 筆觸也要知道質地與是不是塗在唇上
  };
}

/**
 * 鏡面上的互動：
 *   全臉模式 → 按住暫時卸妝
 *   對比模式 → 拖曳分界線（線本身就是把手，不必去找一顆小圓點）
 *   手動模式 → 在自己臉上畫
 */
function bindMirror(frame) {
  bindHold(frame);
  const hold = frame.onpointerdown;
  const moveTo = (e) => {
    const c = $('#ar');
    const fx = Math.min(0.94, Math.max(0.06, toCanvas(e, c)[0] / c.width));
    S.splitX = fx;
    // 記住的是「相對臉中線偏多少」，不是畫面位置 —— 人一移動，線就跟著臉走
    if (smooth) S.splitOff = fx - faceMidX(smooth);
  };

  // 畫布是 object-fit:cover —— CSS 位置換算成畫布像素時必須把裁切算進去，
  // 直接用 r.width 當比例，點會整片偏掉（畫布 4:3、外框直式時偏得最兇）。
  const toCanvas = (e, c) => {
    const r = c.getBoundingClientRect();
    const k = Math.max(r.width / c.width, r.height / c.height);
    return [(e.clientX - r.left - (r.width - c.width * k) / 2) / k,
            (e.clientY - r.top - (r.height - c.height * k) / 2) / k];
  };

  let lastPt = null, lastK = 1;
  const strokeTo = (e) => {
    const c = $('#ar');
    if (!smooth || !c.getBoundingClientRect().width) return;
    const P = toPixels(smooth, c.width, c.height);
    const [px, py] = toCanvas(e, c);
    const o = brushOpts();
    const k = strokePressure(e);
    // 兩個事件之間補點，快速拖曳才不會畫成一串斷掉的點
    const steps = lastPt ? Math.min(14, Math.ceil(Math.hypot(px - lastPt[0], py - lastPt[1]) / 6)) : 1;
    for (let i = 1; i <= steps; i++) {
      const t2 = steps === 1 ? 1 : i / steps;
      const qx = lastPt ? lastPt[0] + (px - lastPt[0]) * t2 : px;
      const qy = lastPt ? lastPt[1] + (py - lastPt[1]) * t2 : py;
      // 筆壓也要一起內插。只用事件當下那一個值的話，補出來的點會整段同壓，
      // 快速加壓時中間會出現一條肉眼看得到的硬邊。
      const qk = lastPt ? lastK + (k - lastK) * t2 : k;
      const uv = screenToUV(P, qx, qy);
      if (uv) brushDab(uv[0], uv[1], applyPressure(o, qk));
    }
    lastPt = [px, py]; lastK = k;
    lastSig = '';           // 手繪層動過，讓貼圖下一幀一定重建
  };

  // 輕點（短、幾乎沒移動）跟按住是兩件事：按住看素顏，輕點是「問這個部位」
  let tapT0 = 0, tapPt = null;
  const tapStart = (e) => { tapT0 = performance.now(); tapPt = toCanvas(e, $('#ar')); };
  const tapEnd = (e) => {
    if (!tapPt || S.tab === 'paint') { tapPt = null; return false; }
    const c = $('#ar'); const [x, y] = toCanvas(e, c);
    const moved = Math.hypot(x - tapPt[0], y - tapPt[1]);
    const dt = performance.now() - tapT0;
    tapPt = null;
    if (dt > 320 || moved > 12) return false;      // 那是按住或拖曳，不是點
    return tapRegion(x, y, c.width, c.height);
  };

  frame.onpointerdown = (e) => {
    if (onControl(e)) return;
    tapStart(e);
    if (S.tab !== 'paint' && S.mode === 'full') return hold(e);
    e.preventDefault();
    try { frame.setPointerCapture?.(e.pointerId); } catch { /* 指標已不存在，不影響後續 */ }
    if (S.tab === 'paint') {
      frame.classList.add('painting');
      lastPt = null;
      beginStroke();
      strokeTo(e);
      frame.onpointermove = strokeTo;
      return;
    }
    frame.classList.add('dragging');
    moveTo(e);
    frame.onpointermove = moveTo;
  };
  const end = (e) => {
    if (S.tab === 'paint' && frame.onpointermove) {
      pushStroke();
      // 畫完一筆還是沒量到筆壓 —— 這台裝置就是沒有，面板上要說清楚
      if (!pressSeen && !noPressNoted) { noPressNoted = true; mountPanel(); }
    }
    frame.onpointermove = null;
    lastPt = null;
    frame.classList.remove('dragging', 'painting');
    try { frame.releasePointerCapture?.(e.pointerId); } catch { /* 同上 */ }
  };
  const prevUp = frame.onpointerup;
  frame.onpointerup = (e) => {
    const tapped = tapEnd(e);
    if (S.tab !== 'paint' && S.mode === 'full') { prevUp(e); return; }
    end(e);
    if (tapped) return;
  };
  frame.onpointercancel = frame.onpointerup;
  frame.onpointerleave = (e) => { if (S.tab !== 'paint' && S.mode === 'full') return prevUp(e); if (frame.onpointermove) end(e); };
}

/** 畫面上的鈕改了模式時，對話裡的選項標籤要跟著換，不然會出現「開了卻還寫開啟」 */
function syncAROpts() {
  const c = S.chat.s4;
  if (!c?.msgs?.length) return;
  c.opts = arOpts();
  mountChat('s4');
}

function mountZoomBtn() {
  const b = $('#zoom-btn');
  b.textContent = t(S.zoom ? 'btn.zoomOff' : 'btn.zoom');
  b.classList.toggle('on', S.zoom);
}

function updateCallout() {
  $('#callout').textContent = t('callout', { shade: tf(S.picks.lip, 'shade'), finish: finishLabel(S.picks.lip.finish) });
  syncSheet();          // 抽屜標題上的色號跟著換
}

/** 臉的中線在畫布上的水平位置（0..1）：鼻樑、鼻尖、上唇、下唇四點平均，頭稍微轉也穩 */
const faceMidX = (lm) => (lm[168].x + lm[1].x + lm[0].x + lm[17].x) / 4;

const base4 = el('canvas'), out4 = el('canvas');
const lumaCv = el('canvas'); lumaCv.width = 32; lumaCv.height = 24;
/** 畫面平均亮度（0–1）。縮到 32×24 再讀，成本可以忽略 */
function frameLuma(src) {
  try {
    const x = lumaCv.getContext('2d', { willReadFrequently: true });
    x.drawImage(src, 0, 0, 32, 24);
    const d = x.getImageData(0, 0, 32, 24).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (32 * 24) / 255;
  } catch { return null; }
}
let smooth = null;

// 實測（_ar.html）：臉部追蹤 21.5 ms/幀，上妝渲染 0.9 ms/幀 —— 追蹤佔 96%。
// 所以把「追蹤頻率」和「渲染頻率」拆開：追蹤跑 ~30Hz 就夠（臉不會動那麼快），
// 畫面則每個 vsync 都重畫，這樣影像不會卡頓，追蹤成本也砍掉一截。
const DEBUG = /[?&]debug/.test(location.search);
const DETECT_MS = 33;    // 追蹤目標間隔
const HOLD_MS   = 300;   // 追蹤掉幀時，最多沿用上一組關鍵點多久

/** 分界線與兩側標籤。線畫粗一點，因為它同時是拖曳的把手。 */
function drawSplitUI(x, W, H) {
  const px = Math.round(W * S.splitX);
  x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(px - 2, 0, 4, H);
  x.fillStyle = 'rgba(209,115,140,.95)'; x.fillRect(px - 1, 0, 2, H);

  // 把手
  x.beginPath(); x.arc(px, H / 2, 15, 0, 7); x.fillStyle = 'rgba(209,115,140,.95)'; x.fill();
  x.strokeStyle = '#fff'; x.lineWidth = 2; x.stroke();
  x.fillStyle = '#fff'; x.font = '700 13px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('↔', px, H / 2 + 1);
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';

  const L = S.mode === 'dual' ? tf(S.picks.lip, 'shade') : t('split.after');
  const R = S.mode === 'dual' ? (S.pickB ? tf(S.pickB, 'shade') : '—') : t('split.before');
  x.font = '600 12px sans-serif';
  for (const [txt, cx, align] of [[L, px - 10, 'right'], [R, px + 10, 'left']]) {
    const w = x.measureText(txt).width;
    const bx = align === 'right' ? cx - w - 9 : cx;
    x.fillStyle = 'rgba(74,52,60,.78)';
    x.beginPath(); x.roundRect(bx - 4, 10, w + 17, 22, 11); x.fill();
    x.fillStyle = '#fff'; x.fillText(txt, bx + 4, 25);
  }
}

function arLoop() {
  const v = $('#cam'), disp = $('#ar'), dctx = disp.getContext('2d');
  let lastDetect = -1e9, lastSeen = -1e9, detectMs = 0, lastIllum = -1e9;
  let fpsWin = 0, fpsCount = 0;

  const frame = async (ts) => {
    if (S.step !== 4) return;
    if (v.readyState >= 2) {
      const W = 640, H = Math.round((v.videoHeight / v.videoWidth) * 640) || 480;
      for (const c of [disp, base4, out4]) { if (c.width !== W) { c.width = W; c.height = H; } }

      // 鏡像後的素顏幀
      const b = base4.getContext('2d', { willReadFrequently: true });
      b.save(); b.scale(-1, 1); b.drawImage(v, -W, 0, W, H); b.restore();

      if (ts - lastDetect >= DETECT_MS) {
        lastDetect = ts;
        const t0 = performance.now();
        let lm = null;
        try { lm = await detectVideo(base4, ts); } catch {}
        detectMs = detectMs * 0.8 + (performance.now() - t0) * 0.2;
        if (lm) {
          lastSeen = ts;
          // EMA 平滑，消除逐幀抖動
          smooth = smooth && smooth.length === lm.length
            ? lm.map((p, i) => ({ x: smooth[i].x * 0.45 + p.x * 0.55, y: smooth[i].y * 0.45 + p.y * 0.55 }))
            : lm.map((p) => ({ x: p.x, y: p.y }));
          // 環境光每秒用眼白重估一次：櫃位燈光、使用者轉身，照在唇上的光都會變。
          // 小步混合進去，不讓整片妝跟著一次跳色。
          if (ts - lastIllum > 1000) { lastIllum = ts;
            const cq = loadChartQuad(), cf = cq ? fitFromCanvas(base4, cq) : null;
            if (cf) { setColorMatrix(cf.M, 0.3); setLighting([1, 1, 1], 0.3); S.chartFit = cf; }
            else setColorMatrix(null, 0.3);
            const il = cf ? { reliable: true } : estimateIlluminant(base4, smooth);
            const h = il?.reliable ? null : estimateHighlight(base4, smooth);
            if (!cf && il?.reliable) setLighting(il.gainWide, 0.3);
            else if (h?.reliable) setLighting(h.gain, 0.3);
            // 現場光線有多可信，照實說 —— 還原度取決於它
            const was = JSON.stringify(S.lightNote);
            S.lightNote = lightNote(!!il?.reliable, !!h?.reliable, frameLuma(base4));
            if (JSON.stringify(S.lightNote) !== was) advise4();
            watchAR(smooth, W); }
          if (S.yesNo) feedGesture(smooth, W, H, ts);   // 有是非題等著 → 開始看點頭／搖頭
        }
      }

      // 追蹤短暫掉幀時沿用上一組關鍵點，妝不會一閃一閃地掉
      if (smooth && ts - lastSeen < HOLD_MS) {
        syncMakeup();
        syncMakeupB();
        // 分屏交給著色器處理（範圍外直接 discard），比事後裁切乾淨
        // 手動上妝也是整臉，不能沿用對比模式的分界線 —— 否則右半邊會被 discard，
        // 畫得再認真也只有左半邊看得到。
        // 分界線跟著臉走。固定在畫面正中間的話，人站得稍微偏一點，整張臉就落在
        // 同一側 —— 雙色對比只看得到一支色號。實測假鏡頭的唇就被切成 20% / 80%。
        S.splitX = Math.min(0.94, Math.max(0.06, faceMidX(smooth) + S.splitOff));
        setSplit(S.mode === 'bare' || S.mode === 'dual' ? S.splitX : -1);
        const ph = applyPhase();      // 上妝掃掠 / 按住看素顏
        setIntensity(ph.k); setSweep(ph.sweep); useBrush(true);

        dctx.drawImage(base4, 0, 0);
        const ok = renderGL(dctx, toPixels(smooth, W, H), W, H);
        if (!ok) {
          // 沒有 WebGL 時退回舊的 2D 版本
          const o = out4.getContext('2d');
          o.clearRect(0, 0, W, H); o.drawImage(base4, 0, 0);
          if (!holdBare) renderMakeup(o, base4, smooth, cfg());   // 2D 退路也要吃「按住看素顏」
          if (S.mode === 'bare') { const bx = Math.round(W * S.splitX); dctx.drawImage(out4, 0, 0, bx, H, 0, 0, bx, H); }
          else dctx.drawImage(out4, 0, 0);
        }
        if (S.zoom) drawLipZoom(dctx, smooth, W, H);
        drawMark(dctx, smooth, W, H);      // AI 講到哪，就在鏡子上圈到哪
        if (S.mode === 'bare' || S.mode === 'dual') drawSplitUI(dctx, W, H);
        if (DEBUG) debugOverlay(dctx, smooth, W, H);
      } else {
        smooth = null;
        dctx.drawImage(base4, 0, 0);
      }

      fpsCount++;
      if (ts - fpsWin >= 500) {
        const fps = Math.round(fpsCount * 1000 / (ts - fpsWin));
        $('#fps').textContent = t('fps', { fps, ms: detectMs.toFixed(1) }) +
          (smooth && ts - lastSeen < HOLD_MS ? '' : t('fps.noface'));
        fpsWin = ts; fpsCount = 0;
      }
    }
    S.raf = requestAnimationFrame(frame);
  };
  fpsWin = performance.now();
  S.raf = requestAnimationFrame(frame);
}

// ═══════════════ 評價與報告（畫面上的第 4 步）═══════════════

const TAG_IDS = [0, 1, 2, 3, 4, 5];

/**
 * 報告裡的前後對照：同一張照片、同一個位置，右邊套上這次實際用的妝。
 * 用的是 S.picks / S.amount（使用者調過的），不是妝容的預設值 ——
 * 報告要反映他真的做了什麼，不是我們原本推薦什麼。
 */
function paintBA() {
  const draw = (id, makeup) => {
    const c = $(id), ctx = c.getContext('2d', { willReadFrequently: true });
    c.width = S.photo.width; c.height = S.photo.height;
    ctx.drawImage(S.photo, 0, 0);
    if (!makeup) return;
    syncMakeup(); setSplit(-1); setIntensity(100); setSweep(-1); useBrush(true);
    resetRefs();   // 在照片上渲染：唇與皮膚的亮度基準要從這張圖重新量
    if (!renderGL(ctx, toPixels(S.photoLm, c.width, c.height), c.width, c.height)) {
      renderMakeup(ctx, S.photo, S.photoLm, cfg());
    }
  };
  draw('#rep-before', false);
  draw('#rep-after', true);
}

// ═══════════════ 上妝結果的實測與評價 ═══════════════
// 這一段量的是「上妝後的畫面」，不是商品色卡。皮膚會透出來，
// 所以實際呈現的顏色一定不等於瓶子裡的顏色 —— 要給結果的評價與
// 依結果的推薦，就得量結果本身。

/** 兩個關鍵點之間插值，用來取「唇瓣中段」這種沒有單一關鍵點的位置 */
const lerpLm = (a, b, t) => ({
  x: S.photoLm[a].x + (S.photoLm[b].x - S.photoLm[a].x) * t,
  y: S.photoLm[a].y + (S.photoLm[b].y - S.photoLm[a].y) * t,
});

// 唇：從外輪廓往內輪廓走 45%，落在唇瓣中段 —— 直接用內輪廓會取到齒縫與口腔
const LIP_PTS   = [[17, 14, .45], [0, 13, .45], [314, 402, .4], [84, 178, .4]];
const CHEEK_PTS = [[50, 50, 0], [280, 280, 0]];
const LID_PTS   = [[27, 27, 0], [257, 257, 0]];

function labAt(ctx, W, H, pts, r = 3) {
  const px = [];
  for (const [a, b, t] of pts) {
    const p = lerpLm(a, b, t);
    const cx = Math.round(p.x * W), cy = Math.round(p.y * H);
    if (cx < r || cy < r || cx >= W - r || cy >= H - r) continue;
    const d = ctx.getImageData(cx - r, cy - r, r * 2 + 1, r * 2 + 1).data;
    for (let k = 0; k < d.length; k += 4) px.push(rgbToLab(d[k], d[k + 1], d[k + 2]));
  }
  if (!px.length) return null;
  const med = (key) => { const v = px.map((p) => p[key]).sort((x, y) => x - y); return v[v.length >> 1]; };
  return { L: med('L'), a: med('a'), b: med('b') };
}

const hueOf = (lab) => (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
const hueGap = (h1, h2) => { const d = Math.abs(h1 - h2) % 360; return d > 180 ? 360 - d : d; };

/**
 * 量測上妝前後，並推出「有效覆蓋率 α」。
 * after ≈ bare + α·(product − bare)，把 (after−bare) 投影到 (product−bare) 上求 α。
 * 有了 α 就能預測「換成另一支色號會變成什麼樣子」，而不是拿色卡直接比 ——
 * 色卡上看起來差很多的兩支，上到唇上可能幾乎一樣。
 */
function measureAfter() {
  const b = $('#rep-before').getContext('2d', { willReadFrequently: true });
  const a = $('#rep-after').getContext('2d', { willReadFrequently: true });
  const W = $('#rep-after').width, H = $('#rep-after').height;

  const bare = labAt(b, W, H, LIP_PTS), lip = labAt(a, W, H, LIP_PTS);
  if (!bare || !lip) return null;
  const prod = hexToLab(S.picks.lip.color);

  const v = [prod.L - bare.L, prod.a - bare.a, prod.b - bare.b];
  const u = [lip.L - bare.L, lip.a - bare.a, lip.b - bare.b];
  const vv = v[0] ** 2 + v[1] ** 2 + v[2] ** 2;
  const alpha = vv < 1e-6 ? 0
    : Math.min(1, Math.max(0.05, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / vv));

  return {
    bare, lip, alpha,
    cheek: labAt(a, W, H, CHEEK_PTS),
    lid: labAt(a, W, H, LID_PTS),
    predict: (hex) => {
      const q = hexToLab(hex);
      return { L: bare.L + alpha * (q.L - bare.L),
               a: bare.a + alpha * (q.a - bare.a),
               b: bare.b + alpha * (q.b - bare.b) };
    },
  };
}

// 門檻是「比素顏多出來的存在感」，不是唇與膚的絕對色差 ——
// 素顏的唇本來就跟臉頰差 ΔE 30 上下，拿絕對值當門檻等於每個人都是「強烈」。
const CONTRAST_BANDS = [
  { max: 8,   id: 'band.subtle' },
  { max: 16,  id: 'band.daily' },
  { max: 28,  id: 'band.clear' },
  { max: 1e9, id: 'band.strong' },
];

// 契合度的分級。分數本身沒有意義，要說出它代表什麼。
const MATCH_BANDS = [
  { min: 85, id: 'grade.high' },
  { min: 70, id: 'grade.beauty' },
  { min: 55, id: 'grade.part' },
  { min: -1, id: 'grade.low' },
];

/**
 * 打的分數是「契合度」—— 不是評價這張臉好不好看，是量這組妝
 * 跟三個客觀對象合不合：
 *   膚色契合 — 三件商品的色調與偵測到的底調是否一致
 *   配色契合 — 唇彩與腮紅的色相差（同色系妝感的關鍵）
 *   強度契合 — 實際上妝幅度是否落在這個妝容自己設定的強度
 * 三項都是量出來的，不是形容詞。低的時候照實說並給可執行的下一步：
 * 契合度是可以修的，「好不好看」不是，這也是它值得打分的原因。
 */
function evaluate(meas) {
  const tone = S.skin.undertone;
  const fitEach = ['lip', 'eye', 'cheek'].map((k) =>
    S.picks[k].tone === tone ? 1 : S.picks[k].tone === 'neutral' ? 0.6 : 0.25);
  const fit = Math.round((fitEach.reduce((x, y) => x + y, 0) / 3) * 100);

  // 和諧度用「商品色」而不是量到的頰色：腮紅本來就淡，量到的頰色九成是皮膚，
  // 拿它跟唇比等於在比膚色與唇色，測不到配色本身。
  const dh = hueGap(hueOf(hexToLab(S.picks.lip.color)), hueOf(hexToLab(S.picks.cheek.color)));
  const harmony = Math.round(Math.max(0, 100 - dh * 1.7));

  // 兩個不同的量：
  //   gain     上妝幅度 —— 妝把唇色改變了多少（ΔE 素唇 → 上妝後）
  //   standout 存在感   —— 比素顏多出來的唇/膚對比
  const gain = deltaE(meas.lip, meas.bare);
  const standout = deltaE(meas.lip, S.skin.lab) - deltaE(meas.bare, S.skin.lab);
  const band = CONTRAST_BANDS.find((x) => standout <= x.max);
  // 妝容自己的強度設定（0–1）換算成期望的上妝幅度，離得越遠完成度越低
  const wantMid = 4 + (S.look.intensity.lip ?? 1) * 17;
  const done = Math.round(Math.max(0, 100 - Math.abs(gain - wantMid) * 3));

  const match = Math.round(fit * 0.4 + harmony * 0.32 + done * 0.28);
  const grade = MATCH_BANDS.find((x) => match >= x.min);

  const says = [];
  says.push(t('say.match', { n: match, grade: t(grade.id), say: t(grade.id + '.say') }));
  says.push(t('say.gain', { gain: gain.toFixed(1), standout: standout.toFixed(1), band: t(band.id + '.say') }));
  // 門檻對齊實際算法：三件全吻合才是 100，摻一件中性色就掉到 87。
  // 分數說 87、文字卻說「全部吻合」，等於自己拆自己的台。
  const tn = { tone: toneLabel(tone) };
  if (fit >= 95) says.push(t('say.fitAll', tn));
  else if (fit >= 70) says.push(t('say.fitSome', tn));
  else says.push(t('say.fitNone', tn));
  if (meas.cheek) {
    says.push(t(dh <= 18 ? 'say.hueOk' : 'say.hueBad', { dh: dh.toFixed(0) }));
  }
  if (done < 70) {
    says.push(t(gain < wantMid ? 'say.tooLight' : 'say.tooHeavy'));
  }

  return { fit, harmony, done, match, grade, gain, standout, band, dh, want: wantMid, say: says.join(t('say.sep')) };
}

const fmtDur = (ms) => {
  const sec = Math.round(ms / 1000);
  return sec >= 60 ? t('dur.mm', { m: Math.floor(sec / 60), s: sec % 60 }) : t('dur.ms', { s: sec });
};

/** 體驗報告 + 推薦商品。這是唯一談價格與購買的地方。 */
function paintReport() {
  paintBA();
  const meas = measureAfter();
  if (DEBUG) globalThis.__LUCID_MEAS__ = meas;
  paintVerdict(meas);

  const sk = S.skin, lab = sk.lab;
  const rank = S.ranked.find((r) => r.look.id === S.look.id);
  const triedNames = [...S.tried]
    .map((id) => { const p = PRODUCTS.find((x) => x.id === id); return p && tf(p, 'shade'); })
    .filter(Boolean);

  const cell = (cap, main, sub) =>
    `<div><span>${cap}</span><b>${main}${sub ? `<small>${sub}</small>` : ''}</b></div>`;

  $('#rep-grid').innerHTML =
    cell(t('cell.skin'), `${t('depth.' + sk.depthKey)} · ${toneLabel(sk.undertone)}`,
         `L* ${lab.L.toFixed(1)}　a* ${lab.a.toFixed(1)}　b* ${lab.b.toFixed(1)}`) +
    cell(t('cell.ita'), `${sk.itaDeg.toFixed(1)}°`,
         t('cell.itaSub', { r: (sk.residual > 0 ? '+' : '') + sk.residual.toFixed(1) })) +
    cell(t('cell.light'),
         S.illum && S.skinWB ? `${S.illum.cct} K` : t('cell.lightOff'),
         S.illum && S.skinWB ? t('cell.lightSub', { n: S.illum.samples }) : t('cell.lightBad')) +
    cell(t('cell.look'), tf(S.look, 'name'), t('cell.lookSub', { n: rank ? rank.score : '—' })) +
    cell(t('cell.shades'), t('cell.shadesN', { n: S.tried.size }), triedNames.join('　·　') || '—') +
    cell(t('cell.tryon'), fmtDur(S.arMs), t('cell.tryonSub', { shade: tf(S.picks.lip, 'shade') }));

  $('#rep-note').textContent = sk.warnings.length
    ? '⚠ ' + sk.warnings.map((w) => t(w)).join('　')
    : t('rep.note');

  paintRecItems();
  paintAfterRecs(meas);
  paintTotal();
  paintPanel();
}

/** 已經在購物袋裡的，就不再給「加入」的選項 */
function bagHas(act) {
  const cats = act === 'buyLip' ? ['lip'] : ['lip', 'eye', 'cheek'];
  return cats.every((c) => !S.picks?.[c] || S.picks[c].stock <= 0 || S.bag.includes(S.picks[c].id));
}

function paintRecItems() {
  // ── 推薦商品（含替代色號） ──
  const box = $('#rec-items'); box.innerHTML = '';
  for (const cat of ['lip', 'eye', 'cheek']) {
    const p = S.picks[cat];
    const row = el('div', 'item');
    row.innerHTML =
      swatchHTML(p, 'sw') +
      `<div><div class="n">${p.brand} ${tf(p, 'name')}</div>
            <div class="s">${catLabel(cat)} · ${tf(p, 'shade')} · ${finishLabel(p.finish)}</div>
            <div class="tagline">${p._reason.map(trReason).join('　·　')}</div></div>
       <div class="p">$${p.price}<small>${p.stock > 0 ? t('stock.n', { n: p.stock }) : t('stock.out')}</small></div>`;

    const add = el('button', 'add' + (S.bag.includes(p.id) ? ' in' : ''),
                   t(S.bag.includes(p.id) ? 'bag.added' : 'bag.add'));
    add.disabled = p.stock <= 0;
    add.onclick = () => {
      if (S.bag.includes(p.id)) return;
      S.bag.push(p.id);
      add.textContent = t('bag.added'); add.classList.add('in');
      paintTotal();
    };
    row.appendChild(add);
    box.appendChild(row);
  }
}

/** 上妝結果的契合度：三條量出來的分項 + 一段照實說的評語 */
function paintVerdict(meas) {
  const box = $('#verdict');
  if (!meas) { box.hidden = true; mountAdvisor('#adv5', [], true); return; }
  box.hidden = false;
  const v = evaluate(meas);
  // 給使用者的正面回饋：條件成立才誇，撐不起來就照實說 + 怎麼改
  S.lastV = v;
  // 最後這一支也要算停留時間，不然「你停在哪一支」會漏掉最後一支
  noteDwell(S.pref, S.picks.lip, performance.now() - (S.shadeT0 || performance.now()));
  const sum = sessionSummary({ tried: S.tried.size, shade: tf(S.picks.lip, 'shade'),
                               amount0: S.amount0 ?? S.amount.lip, amount1: S.amount.lip, pref: S.pref });
  const buy = buyAdvice(S.picks, S.level);
  chatReset('s5', [{ kind: 'fact', key: 'adv.hi.s5', params: {} }, ...onFinish(v, S.skin), ...sum,
                   ...levelTip(S.level, 's5'), ...buy.lines, ...learnRecap(S.learned, S.quiz)],
            [...buy.opts.filter((o) => !bagHas(o.act)), ...optsForFinish(), optLearn(), optQuiz()]);
  const bar = (label, n, extra) =>
    `<div class="bar"><span>${label}</span><i><b style="width:${n}%"></b></i><em>${extra ?? n}</em></div>`;
  box.innerHTML =
    `<div class="score"><b>${v.match}</b><span>${t('match.cap')}</span><u>${t(v.grade.id)}</u></div>
     <div class="bars">
       ${bar(t('match.skin'), v.fit)}
       ${bar(t('match.color'), v.harmony, v.dh.toFixed(0) + '°')}
       ${bar(t('match.level'), v.done, 'ΔE ' + v.gain.toFixed(1))}
       <div class="say">${v.say}</div>
     </div>`;
}

/**
 * 依「上妝後的結果」延伸推薦。
 * 用量到的覆蓋率 α 預測每支色號上到這張唇上會變成什麼顏色，再排序 ——
 * 比拿色卡直接比對誠實得多：色卡差很多的兩支，上唇後可能幾乎一樣。
 */
function paintAfterRecs(meas) {
  const box = $('#rec-after');
  if (!meas) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '';

  const cur = S.picks.lip;
  const cand = PRODUCTS.filter((p) => p.cat === 'lip' && p.stock > 0 && p.id !== cur.id)
    .map((p) => {
      const pred = meas.predict(p.color);
      return { p, pred, dSelf: deltaE(pred, meas.lip), dSkin: deltaE(pred, S.skin.lab) };
    });
  if (!cand.length) { box.hidden = true; return; }

  const here = deltaE(meas.lip, S.skin.lab);
  // 同一支不能同時掛「最接近」跟「更淡」—— 選過就從候選裡拿掉
  const used = new Set();
  const pick = (list) => { const hit = list.find((c) => !used.has(c.p.id)); if (hit) used.add(hit.p.id); return hit; };
  const near = pick([...cand].sort((a, b) => a.dSelf - b.dSelf));
  // 覆蓋率低的時候換色號差異本來就小，門檻設死會整欄空著；
  // 找不到明顯更濃／更淡的，就退而給極值那一支，並在文案裡說清楚差多少。
  const boldList = [...cand].sort((a, b) => b.dSkin - a.dSkin);
  const softList = [...cand].sort((a, b) => a.dSkin - b.dSkin);
  const bold = pick(boldList.filter((c) => c.dSkin > here + 1.5)) ?? null;
  const soft = pick(softList.filter((c) => c.dSkin < here - 1.5)) ?? null;

  const rows = [
    near && { ...near, tag: t('rec.near'), why: t('rec.nearWhy', { d: near.dSelf.toFixed(1) }) },
    bold && { ...bold, tag: t('rec.bold'), why: t('rec.boldWhy', { a: here.toFixed(1), b: bold.dSkin.toFixed(1) }) },
    soft && { ...soft, tag: t('rec.soft'), why: t('rec.softWhy', { a: here.toFixed(1), b: soft.dSkin.toFixed(1) }) },
  ].filter(Boolean);

  for (const r of rows) {
    const row = el('div', 'item');
    row.innerHTML =
      swatchHTML(r.p, 'sw') +
      `<div><div class="n">${tf(r.p, 'shade')}<span class="tag">${r.tag}</span></div>
            <div class="s">${r.p.brand} ${tf(r.p, 'name')} · ${finishLabel(r.p.finish)}</div>
            <div class="tagline">${r.why}</div></div>
       <div class="p">$${r.p.price}<small>${t('stock.n', { n: r.p.stock })}</small></div>`;
    const add = el('button', 'add' + (S.bag.includes(r.p.id) ? ' in' : ''),
                   t(S.bag.includes(r.p.id) ? 'bag.added' : 'bag.add'));
    add.onclick = () => {
      if (S.bag.includes(r.p.id)) return;
      S.bag.push(r.p.id);
      add.textContent = t('bag.added'); add.classList.add('in');
      paintTotal();
    };
    row.appendChild(add);
    box.appendChild(row);
  }
  box.appendChild(el('div', 'note', t('rec.note', { a: meas.alpha.toFixed(2) })));
}

function paintTotal() {
  const items = S.bag.map((id) => PRODUCTS.find((p) => p.id === id)).filter(Boolean);
  const sum = items.reduce((n, p) => n + p.price, 0);
  const full = ['lip', 'eye', 'cheek'].reduce((n, k) => n + S.picks[k].price, 0);
  $('#rec-total').textContent = items.length
    ? t('total.some', { n: items.length, sum, full })
    : t('total.none', { full });
}

function enter5() {
  paintReport();

  const st = $('#stars');
  if (!st.children.length) {
    for (let i = 1; i <= 5; i++) {
      const b = el('button', '', '★');
      b.onclick = () => {
        S.rating = i;
        [...st.children].forEach((x, j) => x.classList.toggle('lit', j < i));
        $('#rate-label').textContent = t('rate.' + i);
      };
      st.appendChild(b);
    }
  }
  const tg = $('#tags');
  tg.innerHTML = '';                       // 語言可能換過，標籤要重建
  for (const i of TAG_IDS) {
    const b = el('button', '', t('tag.' + i));
    if (S.tags.has(i)) b.classList.add('on');
    b.onclick = () => { b.classList.toggle('on'); S.tags.has(i) ? S.tags.delete(i) : S.tags.add(i); };
    tg.appendChild(b);
  }

  setActions([
    { label: t('btn.restart'), cls: 'ghost', on: reset },
    { label: t('btn.submit'), cls: 'primary', on: () => {
        console.log('[feedback]', {
          rating: S.rating, tags: [...S.tags], look: S.look?.id,
          bag: S.bag, tried: [...S.tried], arSeconds: Math.round(S.arMs / 1000),
          skin: { ita: S.skin?.itaDeg, undertone: S.skin?.undertone },
        });
        $('#rate-label').textContent = t(S.rating ? 'sent.rated' : 'sent.unrated');
      } },
  ]);
}

function reset() {
  S.photo = S.photoLm = S.skin = S.look = S.picks = null;
  S.bag = []; S.rating = 0; S.tags.clear(); smooth = null;
  S.mode = 'full'; S.tab = 'lip'; S.finish = 'all'; S.splitX = 0.5; S.splitOff = 0; S.pickB = null; S.side = 'a'; lastSigB = 'init';
  S.hist = []; S.redo = [];
  clearBrush();
  S.tried.clear(); S.arMs = 0; S.arT0 = 0;
  S.pref = newPref(); S.said.clear(); S.prevLip = null;
  S.amount0 = null; S.asked3.clear(); S.shadeT0 = 0; S.lastAct = 0;
  S.audience = 'any'; S.asked2.clear(); S.q2 = null; S.audGuess = null; S.audChosen = false; S.level = null;
  S.seasonF = null; S.seasonAns = {}; S.season = null;
  S.learned.clear(); S.quizDone.clear(); S.quiz = { n: 0, ok: 0 }; S.curQuiz = null;
  $('#rec-items').innerHTML = ''; $('#rep-grid').innerHTML = '';
  $('#rec-after').innerHTML = ''; $('#verdict').innerHTML = '';
  [...$('#stars').children].forEach((x) => x.classList.remove('lit'));
  [...$('#tags').children].forEach((x) => x.classList.remove('on'));
  $('#rate-label').textContent = t('rate.0');
  go(1);
}
