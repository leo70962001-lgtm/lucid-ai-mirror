/**
 * 直播間右下角的互動：按讚（連擊）、表情、驚喜禮物。
 * 這裡只放不碰畫面的判斷（好測），畫面與動畫在 app.js。
 */
import { lipFamily } from './lipcolor.js';

/** 按一下讚：總數 +1；上一下在 gap 毫秒內就接著算連擊，不然從 1 重來 */
export function likeTap(st, now, gap = 700) {
  st.total = (st.total || 0) + 1;
  st.combo = st.last && now - st.last <= gap ? (st.combo || 1) + 1 : 1;
  st.last = now;
  return st;
}

/** 連擊到整十（10、20…）的那一下跳橫幅 —— 每一下都跳就變成洗版 */
export const comboMilestone = (combo) => combo >= 10 && combo % 10 === 0;

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
