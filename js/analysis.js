/**
 * Step 2 的「AI 分析」— 色彩科學，不是黑箱
 *
 * 用 CIELAB + ITA°（Individual Typology Angle，皮膚科標準的膚色分類指標）
 * 取代模糊的「冷暖色調」判斷，讓每個推薦都能講出數字依據。
 */

import { SKIN_PATCHES, EYE_R_ALL, EYE_L_ALL } from './makeup.js';

// ── sRGB → CIELAB (D65) ──────────────────────────────────
const inv = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const f   = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function rgbToLab(r, g, b) {
  const R = inv(r / 255), G = inv(g / 255), B = inv(b / 255);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.00000;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const fx = f(X), fy = f(Y), fz = f(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function hexToLab(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** CIE76 色差。ΔE < 2.3 ≈ 肉眼難以分辨 */
export function deltaE(l1, l2) {
  return Math.hypot(l1.L - l2.L, l1.a - l2.a, l1.b - l2.b);
}

// ── 膚色取樣 ─────────────────────────────────────────────
/**
 * 從額頭 / 雙頰 / 下巴取樣，避開唇眼眉。
 * 用 trimmed mean（去掉最亮最暗各 25%）抵抗反光點與陰影。
 */
export function sampleSkin(canvas, lm) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const W = canvas.width, H = canvas.height;
  const R = Math.max(3, Math.round(Math.min(W, H) * 0.012));
  const px = [];

  for (const idx of SKIN_PATCHES) {
    const p = lm[idx];
    if (!p) continue;
    const cx = Math.round(p.x * W), cy = Math.round(p.y * H);
    const x = Math.max(0, cx - R), y = Math.max(0, cy - R);
    const w = Math.min(R * 2, W - x), h = Math.min(R * 2, H - y);
    if (w <= 0 || h <= 0) continue;
    const d = ctx.getImageData(x, y, w, h).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      px.push([d[i], d[i + 1], d[i + 2]]);
    }
  }
  if (px.length < 20) return null;

  px.sort((A, B) => (A[0] + A[1] + A[2]) - (B[0] + B[1] + B[2]));
  const lo = Math.floor(px.length * 0.25), hi = Math.ceil(px.length * 0.75);
  const keep = px.slice(lo, hi);
  const avg = keep.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
                  .map((v) => v / keep.length);

  return { rgb: avg.map(Math.round), samples: px.length };
}

// ── 分類 ─────────────────────────────────────────────────
export const ITA_CLASSES = [
  { min:  55, key: 'very-light' },
  { min:  41, key: 'light' },
  { min:  28, key: 'intermediate' },
  { min:  10, key: 'tan' },
  { min: -30, key: 'brown' },
  { min: -1e9, key: 'dark' },
];

export function classifySkin(rgb) {
  const [r, g, b] = rgb;
  const lab = rgbToLab(r, g, b);

  // ITA° = arctan((L* − 50) / b*) × 180/π
  const itaDeg = (Math.atan2(lab.L - 50, lab.b) * 180) / Math.PI;
  const depth  = ITA_CLASSES.find((c) => itaDeg > c.min);

  // 底調：用「相對於同明度基準線的色相殘差」判定，不用絕對門檻。
  //
  // 真實臉部膚色的 h° 幾乎都擠在 50–80 之間，而且會隨明度系統性
  // 位移（深膚色黑色素散射下降，血紅素的 a* 貢獻相對放大 → h° 降低）。
  // 用固定門檻的話，不是幾乎所有人都被判成暖色調，就是深膚色整批
  // 被誤判成冷色調 —— 兩種錯法都出現過。
  //
  // 基準線由六個涵蓋 Fitzpatrick I–VI 的典型樣本回歸而得：
  //   h_expected ≈ 0.249 × L* + 47.0   （六個樣本殘差皆在 ±2° 內）
  // 明度已經被基準線吸收，所以殘差對深淺膚色是同一把尺。
  const hue      = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  const expected = 0.249 * lab.L + 47.0;
  const residual = hue - expected;
  const undertone = residual > 5 ? 'warm' : residual < -5 ? 'cool' : 'neutral';
  const deep = ['tan', 'brown', 'dark'].includes(depth.key);

  // 誠實標示信心不足的情況
  const warnings = [];
  if (lab.L < 35 || lab.L > 82)
    warnings.push('warn.sparse');
  if (deep)
    warnings.push('warn.deep');
  if (Math.abs(residual) < 2)
    warnings.push('warn.border');

  return {
    rgb, lab, itaDeg, hue, residual, undertone,
    depthKey: depth.key,
    hex: '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join(''),
    warnings,
  };
}

/** 依膚色替妝容排序，並附上人看得懂的理由 */
export function rankLooks(looks, skin) {
  return looks.map((look) => {
    let score = 60;
    const why = [];

    if (look.id === 'retro') {
      if (skin.depthKey === 'very-light' || skin.depthKey === 'light') {
        score += 22; why.push('why.brightLip');
      } else { score += 6; }
    }
    if (look.id === 'natural') {
      score += 18; why.push('why.lowChroma');
    }
    if (look.id === 'kbeauty') {
      if (skin.undertone === 'warm') { score += 20; why.push('why.warmShimmer'); }
      else { score += 10; why.push('why.shimmer'); }
    }
    if (look.id === 'clean') {
      if (skin.undertone === 'neutral') { score += 20; why.push('why.neutralBal'); }
      else { score += 12; }
    }
    if (skin.undertone === 'cool' && look.prefer.lip === 'matte') {
      score += 8; why.push('why.coolMatte');
    }
    return { look, score: Math.min(99, score), why };
  }).sort((a, b) => b.score - a.score);
}

/** CIELAB → sRGB（商品照色彩檢查用） */
export function labToRgb({ L, a, b }) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const g = (t) => (t > 0.206893 ? t * t * t : (t - 16 / 116) / 7.787);
  const X = g(fx) * 0.95047, Y = g(fy), Z = g(fz) * 1.08883;
  const lin = [
    X *  3.2406 + Y * -1.5372 + Z * -0.4986,
    X * -0.9689 + Y *  1.8758 + Z *  0.0415,
    X *  0.0557 + Y * -0.2040 + Z *  1.0570,
  ];
  return lin.map((v) => {
    v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  });
}

/** 從商品照抽出主色：留下彩度最高的一群像素，取中位數 */
export function extractProductColor(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const px = [];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;                       // 去背區
    const lab = rgbToLab(d[i], d[i + 1], d[i + 2]);
    const C = Math.hypot(lab.a, lab.b);
    if (lab.L > 92 && C < 10) continue;                 // 白底
    if (lab.L < 10) continue;                           // 陰影
    px.push({ lab, C });
  }
  if (px.length < 50) return null;
  px.sort((A, B) => B.C - A.C);
  const top = px.slice(0, Math.max(30, Math.floor(px.length * 0.25)));
  const med = (k) => { const v = top.map((p) => p.lab[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const lab = { L: med('L'), a: med('a'), b: med('b') };
  const rgb = labToRgb(lab);
  return { lab, rgb, hex: '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join(''), pixels: px.length };
}

// ── 白平衡：用眼白當中性參考 ───────────────────────────────
/**
 * 為什麼需要這一段：
 * 櫃位的燈光幾乎不會是 D65。暖光下每個人的膚色取樣都會偏黃，
 * ITA° 與底調殘差就會整批位移 —— 也就是說前面校準得再準，
 * 一放到真實櫃位就失效。
 *
 * 臉上有一個現成的中性參考物：眼白。它不是完美的白（略帶黃／粉），
 * 但比「完全不知道光源」好太多，而且關鍵點本來就有。
 * 灰世界假設在這裡不能用 —— 畫面被臉佔滿，把平均值拉成灰會
 * 直接把我們要測的膚色資訊抹掉。
 */

// 光源在物理上是在「線性」光量空間相乘的，不是在 sRGB 的
// gamma 編碼值上。直接對 0–255 的編碼值做乘除會有系統性誤差，
// 所以增益的計算與套用都先解編碼、算完再編回去。
const enc = (v) => {
  v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};

// 眼白的名目反射率（線性 Y，約當 L* 88）。
// 光源同時改變顏色「和」亮度，而底調基準線 h ≈ 0.249·L* + 47 是吃 L* 的
// —— 只還原色度、不還原亮度的話，基準線會拿到錯的 L*，殘差就跟著錯。
// 單張影像無法從曝光反推絕對亮度，所以拿眼白當曝光錨點：
// 校正後眼白應該是中性灰，且亮度回到這個名目值。
const SCLERA_REF_Y = 0.72;

/**
 * von Kries 增益 + 曝光正規化
 *
 * 曝光倍率必須夾限。眼白取樣可能落在眼窩陰影或睫毛上，G 一小
 * 倍率就會爆掉 —— 實測過一次整張臉被推成純白（L* 100、a* 0、b* 0），
 * 於是膚色判成「極淺」、後面所有推薦跟著錯，而且完全不會報錯。
 * 夾限之後最壞情況只是曝光沒完全還原，色度校正仍然有效。
 */
const EXPOSURE_CLAMP = [0.6, 1.8];

// 渲染用的曝光夾限比膚色判定寬。窄夾限是為了保護膚色判定（補過頭會把膚色推成白），
// 但渲染器需要真的曝光倍率：暗場景夾在 1.8 的話，妝會被畫得比臉亮。
const RENDER_CLAMP = [0.25, 6.0];   // 暗場景要補得動：上限 3 在 60% 亮度就已經夾到頂
const HILIGHT_REF_Y = 0.85;   // 皮膚高光接近光源本身，但留一點曝光餘裕

/** 由一塊「已知反射率」的參考色算出三通道增益 */
function gainFrom([r, g, b], refY, clamp) {
  const R = inv(r / 255), G = inv(g / 255), B = inv(b / 255);
  const raw = refY / Math.max(G, 1e-6);
  const k = Math.min(clamp[1], Math.max(clamp[0], raw));
  return [(G / Math.max(R, 1e-6)) * k, k, (G / Math.max(B, 1e-6)) * k];
}

export function wbGain(rgb) { return gainFrom(rgb, SCLERA_REF_Y, EXPOSURE_CLAMP); }

/**
 * 取樣是否可信 —— 只看色度比例，不看曝光。
 * 2700K 鹵素燈的藍色增益本來就會到 4 倍以上，那是正常的櫃位燈光，
 * 不該被當成異常擋掉。真正要擋的是有色光、墨鏡、眼睛半閉。
 */
export function wbReliable([r, g, b]) {
  const R = inv(r / 255), G = inv(g / 255), B = inv(b / 255);
  const ratios = [G / Math.max(R, 1e-6), G / Math.max(B, 1e-6)];
  return ratios.every((v) => v > 0.25 && v < 6);
}

export function applyGain([r, g, b], [gr, gg, gb]) {
  return [enc(inv(r / 255) * gr), enc(inv(g / 255) * gg), enc(inv(b / 255) * gb)];
}

/** McCamy 近似式，把光源色轉成相關色溫，純粹為了讓畫面上有個看得懂的數字 */
export function estimateCCT([r, g, b]) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const R = lin(r / 255), G = lin(g / 255), B = lin(b / 255);
  const X = R * 0.4124 + G * 0.3576 + B * 0.1805;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  const s = X + Y + Z;
  if (s <= 0) return null;
  const x = X / s, y = Y / s;
  const n = (x - 0.3320) / (0.1858 - y);
  return Math.round(449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33);
}

/** 從眼白取樣估計光源色。取不到就回傳 null，寧可不校正也不要亂猜。 */
export function estimateIlluminant(canvas, lm) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const W = canvas.width, H = canvas.height;
  const px = [];

  for (const idx of [EYE_R_ALL, EYE_L_ALL]) {
    const pts = idx.map((i) => lm[i]).filter(Boolean);
    if (pts.length < 6) continue;
    const xs = pts.map((p) => p.x * W), ys = pts.map((p) => p.y * H);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const w = Math.min(W - x0, Math.ceil(Math.max(...xs)) - x0);
    const h = Math.min(H - y0, Math.ceil(Math.max(...ys)) - y0);
    if (w < 3 || h < 3) continue;

    const d = ctx.getImageData(x0, y0, w, h).data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 60) continue;              // 睫毛、虹膜、眼窩陰影
      if ((mx - mn) / mx > 0.22) continue; // 彩度太高，不是眼白
      px.push([r, g, b]);
    }
  }
  if (px.length < 30) return null;

  // 取最亮的四成，避開上眼瞼投下的陰影
  px.sort((A, B) => (B[0] + B[1] + B[2]) - (A[0] + A[1] + A[2]));
  const keep = px.slice(0, Math.max(20, Math.floor(px.length * 0.4)));
  const rgb = keep.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
                  .map((v) => v / keep.length);

  const gain = wbGain(rgb);
  return {
    rgb: rgb.map(Math.round),
    gain, gainWide: gainFrom(rgb, SCLERA_REF_Y, RENDER_CLAMP),   // 渲染器用寬夾限的那一組
    cct: estimateCCT(rgb), samples: px.length,
    reliable: wbReliable(rgb), source: "sclera",
  };
}

/**
 * 白平衡的退路：眼白不可信時（臉太小、瞇眼、戴墨鏡）改用臉上的高光。
 *
 * 皮膚上的高光是菲涅耳反射，幾乎不帶皮膚本身的顏色，所以接近光源色。
 * 準度比眼白差 —— 高光仍混了一點皮膚的色，也會被粉底與出油影響 ——
 * 但比「完全不補償」好得多：不補償時渲染器會把妝畫成完全受光的亮度，
 * 暗場景下妝會比臉還亮。
 *
 * 只給渲染器用。膚色判定仍然只認眼白：它的門檻是用眼白校準的，換來源會讓整批判定位移。
 */
export function estimateHighlight(canvas, lm) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const W = canvas.width, H = canvas.height;
  const xs = lm.map((p) => p.x * W), ys = lm.map((p) => p.y * H);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const w = Math.min(W - x0, Math.ceil(Math.max(...xs)) - x0), h = Math.min(H - y0, Math.ceil(Math.max(...ys)) - y0);
  if (w < 8 || h < 8) return null;
  const d = ctx.getImageData(x0, y0, w, h).data, px = [];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx >= 250) continue;                  // 過曝：已經夾頂，比例不可信
    if (mx < 60) continue;                    // 陰影
    if ((mx - mn) / mx > 0.30) continue;      // 彩度太高：妝、衣服或背景
    px.push([r, g, b]);
  }
  if (px.length < 200) return null;
  px.sort((P, Q) => (Q[0] + Q[1] + Q[2]) - (P[0] + P[1] + P[2]));
  const keep = px.slice(0, Math.max(40, Math.floor(px.length * 0.02)));   // 最亮的 2%
  const rgb = keep.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v / keep.length);
  return { rgb: rgb.map(Math.round), gain: gainFrom(rgb, HILIGHT_REF_Y, RENDER_CLAMP),
           cct: estimateCCT(rgb), samples: keep.length, reliable: wbReliable(rgb), source: "highlight" };
}
