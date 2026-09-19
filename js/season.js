/**
 * 季節判斷（春・夏・秋・冬，四季色彩理論）
 *
 * 四季是三個方向的組合：冷暖（底調）× 明度（亮／深）× 清濁（鮮豔清透／柔和霧感）。
 *   春：暖・亮・清　　夏：冷・亮・濁　　秋：暖・深・濁　　冬：冷・深（或對比強）・清
 *
 * 判斷分兩步（色彩顧問的一般做法）：
 *   1. 先分冷暖 —— 暖的是春或秋，冷的是夏或冬
 *   2. 同一邊再分一次：春 vs 秋 看「明度」，夏 vs 冬 看「清濁（對比）」
 * 直接從四個裡面挑一個反而容易搞錯。
 *
 * 從照片能量到的：膚色（冷暖、明度）、瞳孔與頭髮有多深、五官跟膚色的對比。
 * 量不到的：真正的「披布比對」（拿不同顏色的布放在臉下，看臉色變好還是變差）。
 * 所以結果是「比較接近哪一季」的方向，不是診斷；分不太開時照實說「介於兩者之間」。
 * 門檻只用一張測試臉看過，沒有經過多人校正 —— 文件與對話都照實講。
 *
 * 參考：
 *   メグラシ「春vs秋は明るさ、夏vs冬は濁り」https://lifestyle-media.air-closet.com/know/personal-color/four-seasons-comparison
 *   Curate Your Style「What Is Seasonal Color Analysis?」https://www.curateyourstyle.london/blogs/colour-seasons
 */

import { rgbToLab } from './analysis.js';

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_WARM = { spring: true, autumn: true, summer: false, winter: false };

// 每一季的代表色（只拿來畫色票，給人看「大概是這種感覺」）
export const SEASON_SWATCH = {
  spring: ['#F4845F', '#F7B08A', '#F6D55C', '#9BCB6B'],   // 珊瑚、蜜桃、亮黃、嫩綠
  summer: ['#D8839B', '#B8A2D6', '#8FA7C4', '#C9BFB5'],   // 玫瑰粉、薰衣草、灰藍、灰米
  autumn: ['#C0643F', '#D1A13B', '#8C8B5A', '#7B2C3A'],   // 陶土、芥末黃、卡其、酒紅
  winter: ['#C8102E', '#D6246E', '#2946A6', '#FFFFFF'],   // 正紅、桃紅、寶藍、純白
};

const seaClamp = (v) => Math.min(1, Math.max(0, v));
const seaRamp = (v, lo, hi) => seaClamp((v - lo) / (hi - lo));
const seaSig = (x) => 1 / (1 + Math.exp(-x));

// MediaPipe Face Landmarker 478 點：468–472 右眼虹膜（468 是中心）、473–477 左眼
const SEA_IRIS = [[468, 469, 471], [473, 474, 476]];

/** 圓形區域內像素的明度 L*（排序後回傳），量虹膜用 */
function seaDiscL(ctx, cx, cy, r, W, H) {
  const x0 = Math.max(0, Math.round(cx - r)), y0 = Math.max(0, Math.round(cy - r));
  const w = Math.min(W - x0, Math.round(r * 2) + 1), h = Math.min(H - y0, Math.round(r * 2) + 1);
  if (w < 2 || h < 2) return [];
  const d = ctx.getImageData(x0, y0, w, h).data, out = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if ((x0 + i - cx) ** 2 + (y0 + j - cy) ** 2 > r * r) continue;
    const k = (j * w + i) * 4;
    out.push(rgbToLab(d[k], d[k + 1], d[k + 2]).L);
  }
  return out.sort((a, b) => a - b);
}
const seaMedian = (a) => (a.length ? a[Math.floor(a.length / 2)] : null);

/**
 * 從照片量「季節」要用的特徵。量不到的就是 null —— 不用猜的補。
 * @param hair findHairline 的結果（找到髮際線時才量頭髮）
 * @param illum 眼白估光的結果（眼白的明度拿來算「黑白分明」）
 */
export function seasonFeatures(canvas, lm, skin, hair = null, illum = null) {
  if (!canvas || !lm || !skin) return null;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // 虹膜：取中間那一段的明度（避開瞳孔最黑、反光最亮的部分）
  let eyeL = null;
  if (lm.length >= 478) {
    const vals = [];
    for (const [c, a, b] of SEA_IRIS) {
      const p = lm[c], q = lm[a], s = lm[b];
      const r = (Math.hypot((q.x - p.x) * W, (q.y - p.y) * H) + Math.hypot((s.x - p.x) * W, (s.y - p.y) * H)) / 2;
      if (!(r >= 2)) continue;
      const ls = seaDiscL(ctx, p.x * W, p.y * H, r * 0.75, W, H);
      if (ls.length >= 8) vals.push(seaMedian(ls.slice(Math.floor(ls.length * 0.3), Math.ceil(ls.length * 0.8))));
    }
    if (vals.length) eyeL = vals.reduce((s, v) => s + v, 0) / vals.length;
  }

  // 頭髮：髮際線往上一小段的中位數明度；找不到髮際線（瀏海、帽子、光頭）就不量
  let hairL = null;
  if (hair?.found && hair.gap > 4) {
    const cx = hair.x, cy = hair.y - hair.gap * 0.35, w = hair.gap * 0.9, h = hair.gap * 0.3;
    const x0 = Math.max(0, Math.round(cx - w / 2)), y0 = Math.max(0, Math.round(cy - h / 2));
    const ww = Math.min(W - x0, Math.round(w)), hh = Math.min(H - y0, Math.round(h));
    if (ww > 3 && hh > 3 && y0 >= 0) {
      const d = ctx.getImageData(x0, y0, ww, hh).data, ls = [];
      for (let k = 0; k < d.length; k += 4) ls.push(rgbToLab(d[k], d[k + 1], d[k + 2]).L);
      hairL = seaMedian(ls.sort((a, b) => a - b));
    }
  }

  const scleraL = illum?.rgb ? rgbToLab(...illum.rgb).L : null;
  return { skinL: skin.lab.L, skinC: Math.hypot(skin.lab.a, skin.lab.b), residual: skin.residual,
           eyeL, hairL, scleraL };
}

/**
 * 兩步判斷。
 * @param f       seasonFeatures 的結果
 * @param answers 使用者自己回答的（金／銀飾、珊瑚／磚紅、黑色上衣），會蓋過照片的估計
 */
export function classifySeason(f, answers = {}) {
  if (!f) return null;
  // ── 第一步：冷暖。底調殘差 ±8° 約等於 ±0.76 ──
  let warm = Math.tanh(f.residual / 8);
  if (answers.base === 'warm') warm = 0.35 * warm + 0.65;
  if (answers.base === 'cool') warm = 0.35 * warm - 0.65;

  // ── 明度：膚色為主，頭髮與瞳孔量得到就一起算 ──
  const parts = [[seaRamp(f.skinL, 58, 78), 0.6]];
  if (f.hairL != null) parts.push([seaRamp(f.hairL, 15, 55), 0.2]);
  if (f.eyeL != null) parts.push([seaRamp(f.eyeL, 18, 50), 0.2]);
  let light = parts.reduce((s, [v, w]) => s + v * w, 0) / parts.reduce((s, [, w]) => s + w, 0);
  if (answers.light === true) light = 0.35 * light + 0.65 * 0.85;
  if (answers.light === false) light = 0.35 * light + 0.65 * 0.15;

  // ── 清濁：五官跟膚色的對比、黑白分明的程度；對比強 → 清（冬、春），對比弱 → 濁（夏、秋）──
  const darkest = Math.min(f.hairL ?? 99, f.eyeL ?? 99);
  const cparts = [];
  if (darkest < 99) cparts.push([seaRamp(f.skinL - darkest, 28, 58), 0.7]);
  if (f.scleraL != null && f.eyeL != null) cparts.push([seaRamp(f.scleraL - f.eyeL, 35, 65), 0.3]);
  let clear = cparts.length ? cparts.reduce((s, [v, w]) => s + v * w, 0) / cparts.reduce((s, [, w]) => s + w, 0) : 0.5;
  if (answers.clear === true) clear = 0.35 * clear + 0.65 * 0.85;
  if (answers.clear === false) clear = 0.35 * clear + 0.65 * 0.15;

  // ── 第二步：同一邊再分 —— 春秋看明度、夏冬看清濁 ──
  const pWarm = (warm + 1) / 2;
  const pSpring = seaSig((light - 0.5) / 0.1), pWinter = seaSig((clear - 0.5) / 0.1);
  const scores = {
    spring: pWarm * pSpring, autumn: pWarm * (1 - pSpring),
    summer: (1 - pWarm) * (1 - pWinter), winter: (1 - pWarm) * pWinter,
  };
  const order = [...SEASONS].sort((a, b) => scores[b] - scores[a]);
  const season = order[0];
  const baseUnsure = Math.abs(warm) < 0.3;
  // 分不開的兩種情況：冷暖本身不確定；或冷暖確定、但同一邊那一軸落在中間（±0.08）
  const axis = SEASON_WARM[season] ? light : clear;
  const split = !baseUnsure && Math.abs(axis - 0.5) < 0.08 ? (SEASON_WARM[season] ? 'light' : 'clear') : null;
  // 第二名：冷暖不確定時是另一邊最高的；同一邊分不開時是同一邊的另一季
  const second = baseUnsure ? order.find((x) => SEASON_WARM[x] !== SEASON_WARM[season])
                            : order.find((x) => x !== season && SEASON_WARM[x] === SEASON_WARM[season]);
  return {
    season, second, scores,
    axes: { warm, light, clear },
    between: baseUnsure || !!split,
    baseUnsure,
    split,
    measured: { hair: f.hairL != null, eye: f.eyeL != null, contrast: cparts.length > 0 },
  };
}

// ── 商品顏色屬於哪一季 ────────────────────────────────
// 用實測色值算，不靠人工標：冷暖取商品的底調標記，明度與彩度取 Lab。
// 彩度與明度的中點依品項不同（腮紅本來就淡、眼影本來就灰）。
const SEA_MID = { lip: { L: 52, C: 42 }, cheek: { L: 64, C: 42 }, eye: { L: 60, C: 26 } };

function seaHexLab(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** 0–1：這個顏色有多像那一季。春秋主要看明度、夏冬主要看清濁 —— 跟判斷人的方式一致 */
export function colorSeasonFit(p, season) {
  if (!p?.color || !season) return 0;
  const lab = seaHexLab(p.color), C = Math.hypot(lab.a, lab.b), m = SEA_MID[p.cat] || SEA_MID.lip;
  const warmSeason = SEASON_WARM[season];
  const tone = p.tone === 'neutral' ? 0.6 : (p.tone === 'warm') === warmSeason ? 1 : 0.1;
  const light = seaSig((lab.L - m.L) / 5), clear = seaSig((C - m.C) / 5);
  const wantLight = season === 'spring' || season === 'summer';
  const wantClear = season === 'spring' || season === 'winter';
  const v = wantLight ? light : 1 - light, c = wantClear ? clear : 1 - clear;
  // 春秋：明度 0.4、清濁 0.1；夏冬：清濁 0.4、明度 0.1
  return warmSeason ? 0.45 * tone + 0.4 * v + 0.1 * c + 0.05 : 0.45 * tone + 0.4 * c + 0.1 * v + 0.05;
}

/** 商品最像哪一季（出題、講解用） */
export function seasonOfColor(p) {
  const fits = SEASONS.map((s) => [s, colorSeasonFit(p, s)]).sort((a, b) => b[1] - a[1]);
  return { season: fits[0][0], fit: fits[0][1], margin: fits[0][1] - fits[1][1] };
}

/** 介於兩季之間時，兩邊的顏色都算合適（第二季打九折） */
export function personFit(p, res) {
  if (!res) return null;
  const a = colorSeasonFit(p, res.season);
  return res.between ? Math.max(a, 0.9 * colorSeasonFit(p, res.second)) : a;
}
