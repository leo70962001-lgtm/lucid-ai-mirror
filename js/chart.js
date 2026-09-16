/**
 * 色卡校正（參考 ZOZOGLASS 的做法）
 *
 * ZOZOGLASS 的鏡框上有特殊圖樣，戴著自拍時跟臉一起入鏡當參考，官網說這樣量膚色就不受環境光影響。
 * 同樣的原理：拿拍出來的參考色塊顏色，
 * 對照它本來的顏色，就知道這次的光線與鏡頭把顏色偏成什麼樣子，再把臉上的膚色校正回去。
 *
 * 原本的做法只用眼白一個參考點，只能修「整體偏黃偏藍」（每個通道乘一個倍數）；
 * 而且每個人的眼白本來就不是純白。多塊已知顏色可以擬合一個 3×3 的色彩校正矩陣（CCM），
 * 連鏡頭本身的色彩偏差（例如紅色拍得偏橘）都修得到。
 *
 * 機台版：客人不會戴眼鏡，所以把一張標準色卡（ColorChecker Classic 24 色）固定在
 * 鏡頭拍得到的鏡框邊。位置固定 → 店員在 _chart.html 點一次四個角；之後每次拍照都重新讀色卡、
 * 重新擬合，所以燈光換了也跟得上。
 *
 * 參考值：ColorChecker Classic 24 色常用的 sRGB 近似值（BabelColor／X-Rite 公開資料，D65 換算）。
 * 實體色卡每一批會有些微差異；要求更高的準度時，應該用分光儀量自己那張色卡、把數值換掉。
 */

import { rgbToLab, deltaE } from './analysis.js';

// 6 欄 × 4 列，由左上開始
export const CHART24 = [
  ['dark skin', 115, 82, 68], ['light skin', 194, 150, 130], ['blue sky', 98, 122, 157],
  ['foliage', 87, 108, 67], ['blue flower', 133, 128, 177], ['bluish green', 103, 189, 170],
  ['orange', 214, 126, 44], ['purplish blue', 80, 91, 166], ['moderate red', 193, 90, 99],
  ['purple', 94, 60, 108], ['yellow green', 157, 188, 64], ['orange yellow', 224, 163, 46],
  ['blue', 56, 61, 150], ['green', 70, 148, 73], ['red', 175, 54, 60],
  ['yellow', 231, 199, 31], ['magenta', 187, 86, 149], ['cyan', 8, 133, 161],
  ['white', 243, 243, 242], ['neutral 8', 200, 200, 200], ['neutral 6.5', 160, 160, 160],
  ['neutral 5', 122, 122, 121], ['neutral 3.5', 85, 85, 85], ['black', 52, 52, 52],
];
export const CHART_COLS = 6, CHART_ROWS = 4;

// 膚色最重要：兩塊膚色色塊與中性灰加權，讓校正在膚色附近最準
const CHART_WEIGHT = CHART24.map(([name]) => (/skin/.test(name) ? 3 : /neutral|white/.test(name) ? 2 : 1));

const chartLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const chartEnc = (v) => {
  v = Math.min(1, Math.max(0, v));
  return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
};

/** 色卡四角（正規化座標，順序：左上、右上、右下、左下）→ 每一塊的中心點 */
export function patchCenters(quad) {
  const [tl, tr, br, bl] = quad;
  const out = [];
  for (let r = 0; r < CHART_ROWS; r++) {
    for (let c = 0; c < CHART_COLS; c++) {
      const u = (c + 0.5) / CHART_COLS, v = (r + 0.5) / CHART_ROWS;
      const top = { x: tl.x + (tr.x - tl.x) * u, y: tl.y + (tr.y - tl.y) * u };
      const bot = { x: bl.x + (br.x - bl.x) * u, y: bl.y + (br.y - bl.y) * u };
      out.push({ x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v });
    }
  }
  return out;
}

/** 在畫布上讀 24 塊的平均顏色。只取每塊中間 30%，避開色塊之間的黑框與對焦模糊 */
export function samplePatches(canvas, quad) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const [tl, tr, , bl] = quad;
  const cellW = Math.hypot((tr.x - tl.x) * W, (tr.y - tl.y) * H) / CHART_COLS;
  const cellH = Math.hypot((bl.x - tl.x) * W, (bl.y - tl.y) * H) / CHART_ROWS;
  const r = Math.max(1, Math.round(Math.min(cellW, cellH) * 0.15));
  return patchCenters(quad).map((p) => {
    const cx = Math.round(p.x * W), cy = Math.round(p.y * H);
    const x = Math.max(0, cx - r), y = Math.max(0, cy - r);
    const w = Math.min(W - x, r * 2 + 1), h = Math.min(H - y, r * 2 + 1);
    if (w <= 0 || h <= 0) return null;
    const d = ctx.getImageData(x, y, w, h).data;
    let R = 0, G = 0, B = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
    return n ? [R / n, G / n, B / n] : null;
  });
}

/**
 * 擬合 3×3 色彩校正矩陣：線性 RGB 上最小平方，M · 拍到的 ≈ 標準值。
 * 過曝（任一通道 ≥ 250）或太暗（全部 ≤ 6）的色塊不採用 —— 那些點已經失去顏色資訊。
 * 可用的色塊少於 8 塊就不擬合（回 null），交給眼白／高光的退路。
 */
export function fitCCM(observed, reference = CHART24.map((c) => c.slice(1))) {
  const rows = [];
  observed.forEach((o, i) => {
    if (!o || !reference[i]) return;
    if (o.some((v) => v >= 250) || o.every((v) => v <= 6)) return;
    rows.push({ o: o.map(chartLin), r: reference[i].map(chartLin), w: CHART_WEIGHT[i] ?? 1 });
  });
  if (rows.length < 8) return null;
  // 正規方程：M = (Σ w r oᵀ)(Σ w o oᵀ)⁻¹
  const OO = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], RO = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const { o, r, w } of rows) {
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { OO[a][b] += w * o[a] * o[b]; RO[a][b] += w * r[a] * o[b]; }
  }
  const inv = invert(OO);
  if (!inv) return null;
  const M = RO.map((row) => [0, 1, 2].map((j) => row[0] * inv[0][j] + row[1] * inv[1][j] + row[2] * inv[2][j]));
  return { M, used: rows.length };
}

/** 用矩陣校正一個 8-bit sRGB 顏色 */
export function applyCCM(rgb, M) {
  const l = rgb.map(chartLin);
  return M.map((row) => chartEnc(row[0] * l[0] + row[1] * l[1] + row[2] * l[2]));
}

/** 只用白色塊做的「每通道倍數」校正 —— 等同原本眼白白平衡的能力，拿來比較 */
export function fitGainOnly(observed, whiteIndex = 18) {
  const o = observed[whiteIndex], r = CHART24[whiteIndex].slice(1);
  if (!o) return null;
  const g = o.map((v, i) => chartLin(r[i]) / Math.max(1e-6, chartLin(v)));
  return { M: [[g[0], 0, 0], [0, g[1], 0], [0, 0, g[2]]], used: 1 };
}

export const invertCCM = (M) => invert(M);

/**
 * 校正品質：校正後 24 塊跟標準值的平均色差。
 * 色卡被擋住、移位、反光時這個數字會變大 —— 超過門檻就不採用，退回眼白。
 */
export function chartError(observed, M) {
  let s = 0, n = 0;
  observed.forEach((o, i) => {
    if (!o) return;
    const c = M ? applyCCM(o, M) : o.map(Math.round);
    s += deltaE(rgbToLab(...c), rgbToLab(...CHART24[i].slice(1))); n++;
  });
  return n ? s / n : Infinity;
}
export const CHART_MAX_DE = 6;

/** 一張畫面 → 能用的校正（讀色卡、擬合、檢查品質）；不能用就回 null */
export function fitFromCanvas(canvas, quad) {
  if (!canvas || !quad) return null;
  const obs = samplePatches(canvas, quad);
  const fit = fitCCM(obs);
  if (!fit) return null;
  const de = chartError(obs, fit.M);
  return de <= CHART_MAX_DE ? { ...fit, de, raw: chartError(obs, null) } : null;
}

/**
 * 店員點四個角不必照順序：畫面是鏡像的、色卡也可能轉 90° 裝，
 * 「哪一角是深膚色那塊」很容易點錯。這裡先把四點排成一圈，再試 8 種擺法（4 種旋轉 × 翻面），
 * 留下校正後色差最小的那種 —— 擺法錯的時候中性灰會對到彩色塊，色差差很多，不會選錯。
 */
export function orientQuad(canvas, points) {
  if (!canvas || points?.length !== 4) return null;
  const cx = points.reduce((s, p) => s + p.x, 0) / 4, cy = points.reduce((s, p) => s + p.y, 0) / 4;
  const ring = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let best = null;
  for (const seq of [ring, [...ring].reverse()]) {
    for (let k = 0; k < 4; k++) {
      const quad = [0, 1, 2, 3].map((i) => seq[(i + k) % 4]);
      const obs = samplePatches(canvas, quad);
      const fit = fitCCM(obs);
      if (!fit) continue;
      const de = chartError(obs, fit.M);
      if (!best || de < best.de) best = { quad, ...fit, de, raw: chartError(obs, null), obs };
    }
  }
  return best;
}

function invert(M) {
  const [a, b, c] = M[0], [d, e, f] = M[1], [g, h, i] = M[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

// ── 色卡位置的保存（機台固定裝色卡，位置只需要設定一次）──
const CHART_KEY = 'lucid.chart';
export function saveChartQuad(quad) {
  try { localStorage.setItem(CHART_KEY, JSON.stringify({ quad, at: Date.now() })); } catch { /* 無法存就只在這次有效 */ }
}
export function loadChartQuad() {
  try { const v = JSON.parse(localStorage.getItem(CHART_KEY) || 'null'); return v?.quad?.length === 4 ? v.quad : null; }
  catch { return null; }
}
export function clearChartQuad() { try { localStorage.removeItem(CHART_KEY); } catch { /* 沒有也沒關係 */ } }
