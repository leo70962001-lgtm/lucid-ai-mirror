/**
 * 顯示端校色
 *
 * 為什麼需要：Step 4 渲染出來的顏色是「數值上正確」的，但螢幕會用
 * 自己的原色與 gamma 去呈現它。機台螢幕不是 sRGB 標準的話，顧客看到
 * 的唇色就不等於實品 —— 這是 AR 試妝最容易崩掉信任的地方，也是
 * 前面所有色彩工作的最後一哩。
 *
 * 標準的顯示器特性化模型：
 *   量測值(XYZ) = M · (code^γ)
 * 其中 M 是「裝置線性 RGB → XYZ」的 3×3 矩陣（由三原色的 XYZ 構成），
 * γ 是每通道的轉換曲線。校正就是把它反過來解：
 *   目標 XYZ → M⁻¹ → 裝置線性 → γ 編碼 → 要送給螢幕的碼值
 *
 * 量測需要色差儀，這個模組不負責量測；它負責「拿到量測值之後」的
 * 擬合、校正與驗證。
 */

// sRGB (D65) 參考矩陣
const SRGB_TO_XYZ = [
  [0.4124, 0.3576, 0.1805],
  [0.2126, 0.7152, 0.0722],
  [0.0193, 0.1192, 0.9505],
];

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055);

const mul3 = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);

/** 3×3 反矩陣。行列式接近 0 代表量測到的三原色共線，資料有問題。 */
export function invert3(M) {
  const [a, b, c] = M[0], [d, e, f] = M[1], [g, h, i] = M[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-9) return null;
  return [
    [A / det, -(b * i - c * h) / det,  (b * f - c * e) / det],
    [B / det,  (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det,  (a * e - b * d) / det],
  ];
}

// ── 量測圖卡 ─────────────────────────────────────────────
/** 要量測的色塊：三通道各四階 + 白。共 13 塊。 */
export const PATCHES = (() => {
  const out = [];
  for (const [ch, name] of [[0, 'R'], [1, 'G'], [2, 'B']])
    for (const lv of [0.25, 0.5, 0.75, 1.0]) {
      const code = Math.round(lv * 255);
      const rgb = [0, 0, 0];
      rgb[ch] = code;
      // level 必須是「量化後的真實階調」而不是名目值：
      // 0.25×255 會被 round 成 64，實際是 64/255 = 0.25098。
      // 用名目值擬合會讓 gamma 系統性偏低。
      out.push({ id: `${name}${Math.round(lv * 100)}`, ch, level: code / 255, rgb });
    }
  out.push({ id: 'W100', ch: 3, level: 1.0, rgb: [255, 255, 255] });
  return out;
})();

// ── 擬合 ─────────────────────────────────────────────────
/**
 * @param measured  { [patchId]: {X,Y,Z} }  色差儀讀到的 XYZ（Y 以白 = 100 正規化亦可）
 * @returns { gamma:[3], M, Minv, whiteY } 或 { error }
 */
export function fitDisplay(measured) {
  const need = PATCHES.map((p) => p.id).filter((id) => !measured[id]);
  if (need.length) return { error: `缺少量測值：${need.join(', ')}` };

  // 三原色滿載的 XYZ 就是 M 的三個直行。
  //
  // 這裡必須正規化：色差儀的輸出單位不固定（有的給 cd/m²，有的以白 = 100），
  // 而校正目標的 XYZ 是 0–1 尺度。不把兩邊拉到同一個尺度，Minv 乘出來
  // 會差好幾個數量級，而且不會報錯 —— 只會安靜地產生完全錯誤的顏色。
  // 以「模型白」的 Y 正規化，等同採用相對比色意圖：白對到白。
  const R = measured.R100, G = measured.G100, B = measured.B100;
  const Yw = R.Y + G.Y + B.Y;
  if (!(Yw > 0)) return { error: '三原色的 Y 總和為零，量測資料有誤' };
  const M = [
    [R.X / Yw, G.X / Yw, B.X / Yw],
    [R.Y / Yw, G.Y / Yw, B.Y / Yw],
    [R.Z / Yw, G.Z / Yw, B.Z / Yw],
  ];
  const Minv = invert3(M);
  if (!Minv) return { error: '三原色的 XYZ 共線，量測資料有誤' };

  // 每通道的 gamma：由該通道階調的 Y 對滿載 Y 的比值回歸
  //   Y(level)/Y(1.0) = level^γ  →  γ = log(ratio)/log(level)
  const gamma = [0, 1, 2].map((ch) => {
    const full = [R, G, B][ch].Y;
    const pts = PATCHES.filter((p) => p.ch === ch && p.level < 1);
    const gs = pts.map((p) => {
      const ratio = measured[p.id].Y / full;
      return ratio > 1e-6 ? Math.log(ratio) / Math.log(p.level) : 2.2;
    });
    return gs.reduce((a, b) => a + b, 0) / gs.length;
  });

  return { gamma, M, Minv, whiteY: measured.W100.Y, scale: Yw };
}

// ── 校正 ─────────────────────────────────────────────────
/**
 * 把「想要顧客看到的 sRGB 顏色」轉成「要送給這台螢幕的碼值」。
 * 超出螢幕色域時會夾限，並回報 clipped —— 夾限代表這台螢幕
 * 根本重現不出這個色號，應該讓人知道而不是默默吃掉。
 */
export function correctRgb([r, g, b], model) {
  if (!model || model.error) return { rgb: [r, g, b], clipped: false };
  const lin = [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)];
  const XYZ = mul3(SRGB_TO_XYZ, lin);          // 意圖：這個顏色在 sRGB 下的 XYZ
  const dev = mul3(model.Minv, XYZ);           // 這台螢幕要多少線性訊號才能發出該 XYZ

  let clipped = false;
  const out = dev.map((v, i) => {
    if (v < 0) { clipped = true; v = 0; }
    if (v > 1) { clipped = true; v = 1; }
    return Math.max(0, Math.min(255, Math.round(Math.pow(v, 1 / model.gamma[i]) * 255)));
  });
  return { rgb: out, clipped };
}

const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbToHex = (v) => '#' + v.map((x) => x.toString(16).padStart(2, '0')).join('');

export function correctHex(hex, model) {
  const { rgb, clipped } = correctRgb(hexToRgb(hex), model);
  return { hex: rgbToHex(rgb), clipped };
}

// ── 模擬：拿來驗證整條鏈，也拿來當沒有硬體時的教學用例 ──────
/**
 * 給定一台螢幕的真實特性（原色 XYZ + gamma），算出送進碼值後
 * 實際發出來的 XYZ。色差儀量到的就是這個。
 */
export function simulateDisplay([r, g, b], panel) {
  const lin = [r / 255, g / 255, b / 255].map((v, i) =>
    panel.transfer ? panel.transfer(v) : Math.pow(v, panel.gamma[i]));
  const [X, Y, Z] = mul3(panel.M, lin);
  return { X, Y, Z };
}

/** XYZ → CIELAB，白點取該螢幕的白（相對比色） */
export function xyzToLab({ X, Y, Z }, white) {
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X / white.X), fy = f(Y / white.Y), fz = f(Z / white.Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/**
 * 標準 sRGB 螢幕該有的樣子，用來當「意圖」的參考點。
 * 轉換函數是 sRGB 的分段曲線，不是純 x^2.2 —— 兩者差約 1 ΔE，
 * 拿純冪次當參考會把這個誤差算進校正結果裡。
 */
export const SRGB_PANEL = { M: SRGB_TO_XYZ, gamma: [2.2, 2.2, 2.2], transfer: srgbToLinear };

// ── 存取 ─────────────────────────────────────────────────
const KEY = 'lucid.display.calib';

export function saveCalibration(model) {
  try { localStorage.setItem(KEY, JSON.stringify(model)); return true; } catch { return false; }
}
export function loadCalibration() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    return m && m.Minv && m.gamma ? m : null;
  } catch { return null; }
}
export function clearCalibration() {
  try { localStorage.removeItem(KEY); } catch {}
}
