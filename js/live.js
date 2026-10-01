/**
 * 直播間的互動：驚喜色號、AI 送的貼紙、默契等級（每級特效不同）、AI 對你留言的反應。
 * 這裡只放不碰畫面的判斷（好測），畫面與動畫在 app.js。
 */
import { lipFamily } from './lipcolor.js';

/**
 * 驚喜色號：有庫存、沒試過、跟季節合得來，最好跟現在這支是不同色系（才有「驚喜」）。
 * 前三名裡隨機挑 —— 每次拆都不一樣，但不會拆到不適合的。
 */
export function pickSurprise(products, { currentId = null, tried = new Set(), fit = null, rnd = Math.random } = {}) {
  const lips = products.filter((p) => p.cat === 'lip' && p.stock > 0 && p.id !== currentId);
  if (!lips.length) return null;
  const fresh = lips.filter((p) => !tried.has(p.id));
  const pool = fresh.length ? fresh : lips;
  const cur = products.find((p) => p.id === currentId);
  const curFam = cur ? lipFamily(cur) : null;
  const score = (p) => (fit ? fit(p) ?? 0 : 0) + (curFam && lipFamily(p) !== curFam ? 0.25 : 0);
  const top = pool.map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s).slice(0, 3);
  return top[Math.min(top.length - 1, Math.floor(rnd() * top.length))].p;
}

/* ── AI 主動送的互動：回讚、鼓掌、命中、小禮物 ─────────────────────
   直播主會回應觀眾：觀眾按讚，主播回一個愛心；觀眾做到了什麼，主播鼓掌。
   這裡的 AI 也一樣，但只讚「做了什麼、選了什麼」（試了幾支、色彩跟季節合、學會調濃淡），
   **不評價長相** —— 跟整台機器的立場一樣。
   一直被誇會變吵：每種一場只送一次；靠計時觸發的（命中、停留）兩次之間至少隔 CHEER_GAP_MS。 */
export const CHEER_GAP_MS = 7000;
export const TRIED_MILESTONES = [3, 6, 10];
export const FIT_CHEER = 0.75;          // 跟 seasonShadeLine 說「這支在你的季節裡」用同一條線
export const FIT_DWELL_MS = 4000;       // 停下來看了 4 秒才算「你也在看這支」
export const FIT_MAX = 2;               // 命中一場最多誇兩次
export const GIFT_AR_MS = 60000;        // 試妝一分鐘，AI 送一份驚喜禮物

export const newCheer = () => ({ done: new Set(), last: -1e9, fitN: 0 });

/**
 * 發生了一件事 → 要不要送、送什麼。要送就回傳貼紙內容（並記下來），不送回傳 null。
 * ev.type：like（你按讚）、tried（試了 n 支）、fit（停在一支跟季節合的色號上）、
 *          adjust（第一次調濃淡）、guide（跟著畫完一步）、paint（自己畫第一筆）、time（試妝時間）
 */
export function cheerFor(st, ev, now) {
  let c = null, ticked = false;
  switch (ev.type) {
    case 'like': c = { id: 'like:' + ev.id, emo: '💗', key: 'cheer.likeBack', burst: '💗' }; break;
    case 'tried': {
      // 「到了或超過」就算 —— 二選一一次加兩支，可能從 2 直接跳到 4
      const m = [...TRIED_MILESTONES].reverse().find((x) => ev.n >= x);
      if (m) c = { id: 'tried:' + m, emo: '👏', key: 'cheer.tried', params: { n: ev.n }, burst: '👏' };
      break;
    }
    case 'adjust': c = { id: 'adjust', emo: '👌', key: 'cheer.adjust', burst: '✨' }; break;
    case 'guide': c = { id: 'guide:' + ev.n, emo: '🏅', key: 'cheer.guide', params: { n: ev.n }, burst: '👏' }; break;
    case 'paint': c = { id: 'paint', emo: '🖌️', key: 'cheer.paint', burst: '✨' }; break;
    case 'fit':
      ticked = true;
      if (st.fitN < FIT_MAX && ev.fit >= FIT_CHEER && ev.dwellMs >= FIT_DWELL_MS)
        c = { id: 'fit:' + ev.id, emo: '🎯', key: 'cheer.fit', burst: '✨' };
      break;
    case 'time':
      ticked = true;
      if (ev.arMs >= GIFT_AR_MS) c = { id: 'gift', emo: '🎁', key: 'cheer.gift', burst: '✨', gift: true };
      break;
  }
  if (!c || st.done.has(c.id)) return null;
  // 計時觸發的不急：太密就下次再說（下一幀還會再問）。事件觸發的錯過就沒了，所以照送
  if (ticked && now - st.last < CHEER_GAP_MS) return null;
  st.done.add(c.id); st.last = now;
  if (ev.type === 'fit') st.fitN++;
  return c;
}

/* ── 默契等級（參考直播 App 的粉絲團等級） ─────────────────────
   每跟 AI 互動一次（點一個回覆、拆禮物…）默契 +1；到 3、8、15、25 升一級，
   升級時跳彩帶與橫幅。主播資訊膠囊上看得到等級與進度條。 */
export const RAPPORT_LV = [3, 8, 15, 25];
export const newRapport = () => ({ pts: 0, lv: 0 });
/** 互動一次：回傳現在幾級、這一下有沒有升級、離下一級的進度（0–1） */
export function rapportAdd(st, n = 1) {
  st.pts += n;
  const lv = RAPPORT_LV.filter((x) => st.pts >= x).length;
  const up = lv > st.lv;
  st.lv = lv;
  return { lv, up, pct: rapportPct(st) };
}
export function rapportPct(st) {
  const lo = st.lv ? RAPPORT_LV[st.lv - 1] : 0, hi = RAPPORT_LV[st.lv];
  return hi ? (st.pts - lo) / (hi - lo) : 1;
}

/* ── AI 對你那則留言的反應 ─────────────────────────────────
   直播主看到留言會回個表情；這裡 AI 讀到你的選擇，就在你那則留言尾端蓋一個章：
   表示喜歡 → 💗、調濃淡 → 👌、問為什麼 → 💡、換一支 → 👍…… */
const REACT_BY_ACT = {
  keepYes: '💗', keepBest: '💗', usePref: '💗', tryTrend: '💗', duelLeft: '💗', duelRight: '💗',
  softer: '👌', stronger: '👌', revert: '👌', prefSoft: '👌', prefBold: '👌',
  snap: '📸', surprise: '🎁', compare: '👀', dual: '👀', zoom: '👀',
  learn: '📚', quiz: '📚', quizAns: '📚', trendNow: '📚', seasonColors: '📚',
  guideStart: '👏', guideNext: '👏', guidePaint: '✍️', paintSelf: '✍️', duelStart: '🆚',
};
export const aiReactFor = (act) => (/^why/.test(act || '') ? '💡' : REACT_BY_ACT[act] || '👍');

/**
 * 每一級升級的特效與回饋 —— 越高級越隆重，一眼看得出差別：
 *   Lv1 聊得來：粉紅彩帶＋橫幅
 *   Lv2 有默契：紫色，加中間的等級徽章；送一份禮物
 *   Lv3 好默契：金色，徽章＋煙火；再送一份禮物
 *   Lv4 美妝知己：彩虹，徽章＋光芒＋大量彩帶＋煙火
 * 禮物＝回覆列多一個「🎁 拆開禮物」，點了換上一支驚喜色號。
 */
export const LEVEL_FX = [
  null,
  { emo: '💞', confetti: 24, badge: false, fireworks: 0, rays: false, gift: 0 },
  { emo: '💜', confetti: 36, badge: true, fireworks: 0, rays: false, gift: 1 },
  { emo: '💛', confetti: 48, badge: true, fireworks: 3, rays: false, gift: 1 },
  { emo: '💎', confetti: 80, badge: true, fireworks: 5, rays: true, gift: 0 },
];
export const levelFx = (lv) => LEVEL_FX[Math.max(1, Math.min(LEVEL_FX.length - 1, lv))];
