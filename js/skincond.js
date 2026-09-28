/**
 * 膚況：泛紅、油光、明暗均勻度 → 對應的「上妝」建議
 *
 * 市面上的 AI 膚況分析會量十幾項（毛孔、細紋、痘痘、水分…），多半要高解析度、固定光源。
 * 這台機器只有一般鏡頭、櫃位燈光，量得穩的只有三件事，所以只做這三件：
 *   泛紅　臉頰與鼻翼比額頭紅多少（a* 差）。額頭通常是臉上最不紅的地方，拿它當自己的基準，
 *         不用跟「別人」比 —— 膚色深淺不同的人，a* 的絕對值本來就不一樣。
 *   油光　額頭與鼻子上，接近鏡面反射的點佔多少（很亮、又幾乎沒有顏色的點）。
 *   均勻　十塊取樣區的明度，扣掉「左右打光不一樣」造成的漸層之後還剩多少起伏。
 *
 * 給的是化妝上的建議（綠色飾底、控油、局部遮瑕），不是皮膚檢測；
 * 光線對「油光」影響特別大，所以句子一律寫「看起來」，並且附一句限制。
 * 門檻只用測試照片看過，沒有經過多人校正。
 *
 * 參考（功能面）：
 *   GlamAR「Best AI Skin Analyzer Apps 2026」https://www.glamar.io/blog/ai-skin-analyzer-apps
 *   ScanSkinAI「Selfie skin analysis — 12 metrics」https://www.scanskinai.com/selfie-skin-analysis
 */

import { rgbToLab } from './analysis.js';

const SC_FOREHEAD = [151, 9, 108, 337];
const SC_CHEEK = [50, 280, 101, 330, 205, 425];
const SC_NOSE = [4, 5, 195, 197];
const SC_ALL = [151, 9, 108, 337, 50, 280, 101, 330, 205, 425];

/** 一個取樣點周圍的像素（Lab） */
function scPatch(ctx, lm, idx, W, H, R) {
  const p = lm[idx]; if (!p) return [];
  const cx = Math.round(p.x * W), cy = Math.round(p.y * H);
  const x = Math.max(0, cx - R), y = Math.max(0, cy - R);
  const w = Math.min(R * 2, W - x), h = Math.min(R * 2, H - y);
  if (w <= 0 || h <= 0) return [];
  const d = ctx.getImageData(x, y, w, h).data, out = [];
  for (let i = 0; i < d.length; i += 4) out.push(rgbToLab(d[i], d[i + 1], d[i + 2]));
  return out;
}
const scMean = (a, k) => (a.length ? a.reduce((s, v) => s + v[k], 0) / a.length : null);
const scMedian = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

/** 門檻：低／中／高。只有中、高才會講出來 */
export const SC_LEVELS = {
  red: [3, 6],        // a* 差
  shine: [3, 8],      // 反光點百分比
  uneven: [3, 5.5],   // 明度起伏（L*）
};
export const scLevel = (kind, v) => (v == null ? null : v < SC_LEVELS[kind][0] ? 'low' : v < SC_LEVELS[kind][1] ? 'mid' : 'high');

export function skinCondition(canvas, lm) {
  if (!canvas || !lm) return null;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const R = Math.max(3, Math.round(Math.min(W, H) * 0.014));
  const get = (list) => list.flatMap((i) => scPatch(ctx, lm, i, W, H, R));

  // 泛紅：臉頰＋鼻翼的平均 a* − 額頭的平均 a*
  const fore = get(SC_FOREHEAD), cheek = get(SC_CHEEK), nose = get(SC_NOSE);
  if (fore.length < 20 || cheek.length < 20) return null;
  const red = Math.max(0, (scMean([...cheek, ...nose], 'a') - scMean(fore, 'a')));

  // 油光：T 字（額頭＋鼻子）裡「比這一區中位數亮很多、又幾乎沒有顏色」的點
  const tz = [...fore, ...nose];
  const medL = scMedian(tz.map((c) => c.L));
  const spec = tz.filter((c) => c.L > medL + 12 && Math.hypot(c.a, c.b) < 12).length;
  const shine = (spec / tz.length) * 100;

  // 均勻：每塊的平均明度，扣掉左右方向的線性漸層（打光一邊亮一邊暗）之後的起伏
  const pts = SC_ALL.map((i) => ({ x: lm[i]?.x, L: scMean(scPatch(ctx, lm, i, W, H, R), 'L') }))
    .filter((p) => p.x != null && p.L != null);
  let uneven = null;
  if (pts.length >= 6) {
    const n = pts.length, mx = pts.reduce((s, p) => s + p.x, 0) / n, mL = pts.reduce((s, p) => s + p.L, 0) / n;
    const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0) || 1e-9;
    const slope = pts.reduce((s, p) => s + (p.x - mx) * (p.L - mL), 0) / sxx;
    const res = pts.map((p) => p.L - (mL + slope * (p.x - mx)));
    uneven = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / n);
  }
  return {
    red, shine, uneven,
    level: { red: scLevel('red', red), shine: scLevel('shine', shine), uneven: scLevel('uneven', uneven) },
  };
}

const scLine = (kind, key, params) => ({ kind, key, params: params || {} });

/** 推薦畫面只講最明顯的那一項（沒有明顯的就不講）—— 不要一拍照就挑一堆毛病 */
export function skinCondTop(sc) {
  if (!sc) return [];
  const rank = { high: 2, mid: 1 };
  const top = ['red', 'shine', 'uneven'].filter((k) => rank[sc.level[k]])
    .sort((a, b) => rank[sc.level[b]] - rank[sc.level[a]])[0];
  return top ? [scLine('tip', 'adv.skin.' + top, scParams(sc, top))] : [];
}

const scParams = (sc, k) => (k === 'red' ? { d: sc.red.toFixed(1) } : k === 'shine' ? { p: sc.shine.toFixed(1) } : { d: sc.uneven.toFixed(1) });

/** 「看看我的膚況」：三項都講（量到多少、是低中高），明顯的附上化妝建議，最後一句限制 */
export function skinCondLines(sc) {
  if (!sc) return [scLine('caution', 'adv.skin.none', {})];
  const out = [scLine('fact', 'adv.skin.summary', {
    red: 'sclv.' + sc.level.red, shine: 'sclv.' + sc.level.shine, uneven: 'sclv.' + (sc.level.uneven || 'low'),
  })];
  const any = ['red', 'shine', 'uneven'].filter((k) => sc.level[k] === 'mid' || sc.level[k] === 'high');
  if (any.length) for (const k of any) out.push(scLine('tip', 'adv.skin.' + k, scParams(sc, k)));
  else out.push(scLine('praise', 'adv.skin.good', {}));
  out.push(scLine('caution', 'adv.skin.note', {}));
  return out;
}

/** 油光明顯時，挑唇膏偏好霧面（油亮的臉配水光唇，整張臉都會亮） */
export const skinPrefersMatte = (sc) => sc?.level?.shine === 'high';
