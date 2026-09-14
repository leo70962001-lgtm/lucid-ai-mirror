/**
 * 上妝渲染器 — illumination-aware 的簡化實作
 *
 * 核心：用 canvas 的 'color' 混合模式上色。
 * 'color' 會取「來源的色相+彩度」+「底圖的明度」，
 * 也就是說臉上原本的陰影、反光、皮膚紋理全部保留，只有顏色被換掉。
 *
 * 這是 Yang et al. (EG 2023) 把 bare skin / makeup / illumination 分離
 * 那個想法的輕量版：不重算光照，而是直接沿用底圖既有的明度通道。
 * 差別在論文能做 relighting，這裡不能 —— 但「顏色不會被環境光烘死」
 * 這個最關鍵的性質是一樣的。
 */

// ── 關鍵點索引（MediaPipe FaceMesh 478 點）────────────────
export const LIPS_OUTER = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
  291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
];

// 內唇線。唇彩要塗的是「外輪廓減掉內輪廓」——
// 閉嘴時內輪廓面積趨近 0，看起來沒差別；
// 張嘴笑的時候這一圈就是口腔，不排除掉的話唇彩會直接塗到牙齒上。
export const LIPS_INNER = [
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415,
  308, 324, 318, 402, 317, 14, 87, 178, 88, 95,
];

const EYE_R_UPPER = [33, 246, 161, 160, 159, 158, 157, 173, 133];
const EYE_L_UPPER = [263, 466, 388, 387, 386, 385, 384, 398, 362];
export const EYE_R_ALL   = [...EYE_R_UPPER, 155, 154, 153, 145, 144, 163, 7];
export const EYE_L_ALL   = [...EYE_L_UPPER, 382, 381, 380, 374, 373, 390, 249];
const BROW_R      = [46, 53, 52, 65, 55];
const BROW_L      = [276, 283, 282, 295, 285];

const CHEEK_R = [50, 101, 205];
const CHEEK_L = [280, 330, 425];

/** 取樣膚色的位置：額頭、雙頰上下，避開唇眼眉 */
export const SKIN_PATCHES = [151, 9, 108, 337, 50, 280, 101, 330, 205, 425];

// ── 幾何工具 ─────────────────────────────────────────────
const pt = (lm, i, W, H) => ({ x: lm[i].x * W, y: lm[i].y * H });
const centroid = (ps) => ps.reduce((s, p) => ({ x: s.x + p.x / ps.length, y: s.y + p.y / ps.length }), { x: 0, y: 0 });

/** 用中點二次曲線把離散關鍵點接成平滑輪廓 */
import { COVERAGE } from './makeup-gl.js';   // 覆蓋率表與 WebGL 版共用，不各算各的

function smoothPath(ps) {
  const path = new Path2D();
  if (ps.length < 3) return path;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let m = mid(ps[ps.length - 1], ps[0]);
  path.moveTo(m.x, m.y);
  for (let i = 0; i < ps.length; i++) {
    const cur = ps[i], next = ps[(i + 1) % ps.length];
    m = mid(cur, next);
    path.quadraticCurveTo(cur.x, cur.y, m.x, m.y);
  }
  path.closePath();
  return path;
}

function bbox(ps) {
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** 眼影範圍：從上眼瞼往眉毛方向擴張，形成弧形色塊 */
function eyeshadowPath(lm, W, H, upperIdx, allIdx, browIdx) {
  const upper = upperIdx.map((i) => pt(lm, i, W, H));
  const all   = allIdx.map((i) => pt(lm, i, W, H));
  const brow  = browIdx.map((i) => pt(lm, i, W, H));
  const c     = centroid(all);
  const eyeW  = bbox(all).x1 - bbox(all).x0;
  const gap   = Math.abs(bbox(upper).y0 - bbox(brow).y1);
  const lift  = Math.max(4, Math.min(eyeW * 0.34, gap * 0.85));

  const lifted = upper.map((p) => {
    const dx = p.x - c.x, dy = p.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * lift * 0.45, y: p.y + (dy / len) * lift };
  }).reverse();

  const ring = [...upper, ...lifted];
  return { path: smoothPath(ring), box: bbox(ring) };
}

/** 唇形：外輪廓 + 內輪廓，用 even-odd 填色規則挖空口腔 */
function lipPath(lm, W, H) {
  const outer = LIPS_OUTER.map((i) => pt(lm, i, W, H));
  const inner = LIPS_INNER.map((i) => pt(lm, i, W, H));
  const path = new Path2D();
  path.addPath(smoothPath(outer));
  path.addPath(smoothPath(inner));
  return { path, box: bbox(outer) };
}

// ── 離屏畫布池 ───────────────────────────────────────────
// 只長不縮，且尺寸進位到 64 的倍數 —— 邊界框每幀都會微幅變動，
// 若每幀都改 canvas.width 會觸發重新配置並清空，反而比省下來的還貴。
const pool = [];
function scratch(i, w, h) {
  if (!pool[i]) pool[i] = document.createElement('canvas');
  const c = pool[i];
  const W = Math.ceil(w / 64) * 64, H = Math.ceil(h / 64) * 64;
  if (c.width < W || c.height < H) {
    c.width = Math.max(c.width, W);
    c.height = Math.max(c.height, H);
  }
  return c;
}

// ── 遮擋處理 ─────────────────────────────────────────────
/**
 * 頭髮、眼鏡框、睫毛擋在臉前面時，MediaPipe 仍會「猜」出關鍵點位置，
 * 於是妝就直接畫在遮擋物上。完整解法要跑分割模型，但追蹤已經吃掉
 * 96% 的幀預算，再加一個模型不划算。
 *
 * 這裡做的是「暗色遮擋物拒斥」：比周圍明顯暗的像素不上妝。
 * 用 SVG 的 feColorMatrix luminanceToAlpha 把亮度轉成 alpha，
 * 全程在 GPU 上跑，不需要把像素讀回 CPU（讀回會造成管線停頓）。
 *
 * 擋得住：頭髮、眼鏡框、睫毛、鼻孔、強陰影。
 * 擋不住：手掌等膚色接近的遮擋物 —— 那需要分割模型才行。
 */
const LUM_FILTER_ID = 'lucid-lum2a';
function ensureLumFilter() {
  if (document.getElementById(LUM_FILTER_ID)) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;width:0;height:0';
  svg.innerHTML = `<filter id="${LUM_FILTER_ID}" color-interpolation-filters="sRGB">
    <feColorMatrix type="luminanceToAlpha"/></filter>`;
  document.body.appendChild(svg);
}

/**
 * 求出 brightness()/contrast() 參數，把「亮度低於 t0 → 完全不上妝、
 * 高於 t1 → 完全上妝」這個過渡塞進 canvas filter 能表達的範圍。
 *   brightness: v → v·B      contrast: v → (v−0.5)·C + 0.5
 * 解 (t0·B−0.5)·C+0.5 = 0 與 (t1·B−0.5)·C+0.5 = 1。
 */
function lumGate(t0, t1) {
  const d = Math.max(t1 - t0, 0.02);
  const C = 1 + 2 * t0 / d;
  const B = 1 / (d * C);
  return `brightness(${B.toFixed(4)}) contrast(${C.toFixed(4)}) url(#${LUM_FILTER_ID})`;
}

let noiseTile = null;
function getNoise() {
  if (noiseTile) return noiseTile;
  const n = document.createElement('canvas');
  n.width = n.height = 64;
  const c = n.getContext('2d');
  const img = c.createImageData(64, 64);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() < 0.06 ? 200 + Math.random() * 55 : 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  noiseTile = n;
  return n;
}

// ── 上色核心 ─────────────────────────────────────────────
/**
 * @param dst    目標 2D context
 * @param base   底圖 canvas（未上妝）
 * @param path   Path2D 區域
 * @param opts   { color, finish, alpha, blur, box }
 */
// ── 顏料層的亮度基準 ────────────────────────────────────────
// 舊版直接用 'color' 混合：色相彩度換成商品、**明度留給底圖**。
// 明度留的是嘴唇自己的（天生偏暗），所以每一支色號都被拉向同一種暗紅 ——
// 量測台實測霧面唇膏與色卡差 ΔE00 12.8、色號之間的差異只剩四成。
//
// 現在跟 WebGL 版同一個模型（見 makeup-gl.js 的 FS）：先把底圖亮度乘上
// k = 商品亮度 ÷ 這個區域的平均亮度，再做 'color' 混合。'color' 保留背景明度，
// 所以結果的明度正好是「商品亮度 × 原本的明暗起伏」—— 底色換成商品、紋理保留。
// 2D 沒有線性空間可用，這是 sRGB 空間裡的近似。

/** 商品色的亮度（sRGB，0..1） */
function prodLum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
}

/** 這個區域「只算遮罩內」的平均亮度。用邊界框平均會被旁邊的皮膚拉高，唇就會被畫得太暗 */
function maskedLum(base, fill, x0, y0, w, h) {
  const mc = scratch(2, w, h).getContext('2d', { willReadFrequently: true });
  mc.setTransform(1, 0, 0, 1, 0, 0);
  mc.globalCompositeOperation = 'source-over'; mc.filter = 'none'; mc.globalAlpha = 1;
  mc.clearRect(0, 0, w, h);
  mc.drawImage(base, x0, y0, w, h, 0, 0, w, h);
  mc.globalCompositeOperation = 'destination-in';
  mc.translate(-x0, -y0);
  mc.fillStyle = '#fff';
  fill(mc);
  mc.setTransform(1, 0, 0, 1, 0, 0);
  const d = mc.getImageData(0, 0, w, h).data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 8) {            // 每兩個像素取一個就夠
    if (d[i + 3] < 128) continue;
    sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++;
  }
  return n > 20 ? sum / n / 255 : null;
}

// 亮度基準每幀重算一次太浪費 —— 臉的亮度不會逐幀劇變。每個區域各自快取，6 幀重算。
let lumFrame = 0;
const lumCache = new Map();

/** 底圖亮度要乘的倍率 */
function pigmentK(base, fill, color, x0, y0, w, h, key) {
  const hit = key ? lumCache.get(key) : null;
  if (hit && hit.color === color && lumFrame - hit.frame < 6) return hit.k;
  const ref = maskedLum(base, fill, x0, y0, w, h);
  const k = ref ? Math.min(3, Math.max(0.35, prodLum(color) / ref)) : 1;
  if (key) lumCache.set(key, { k, color, frame: lumFrame });
  return k;
}

function paintRegion(dst, base, path, { color, finish, alpha, blur, box, rule = 'nonzero', gate = null, taper = null, grad = null, coverage = 0, key = '' }) {
  if (alpha <= 0.001 || !box) return;

  // 只處理這個區域的邊界框（含羽化外擴），不動整張畫布。
  // 唇部大約只佔畫面 3%，全畫布處理等於白做 97% 的工。
  const pad = Math.ceil(blur * 3) + 2;
  const x0 = Math.max(0, Math.floor(box.x0 - pad));
  const y0 = Math.max(0, Math.floor(box.y0 - pad));
  const x1 = Math.min(base.width,  Math.ceil(box.x1 + pad));
  const y1 = Math.min(base.height, Math.ceil(box.y1 + pad));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;

  const layer = scratch(0, w, h);
  const lc = layer.getContext('2d');
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.globalCompositeOperation = 'source-over';
  lc.filter = 'none';
  lc.globalAlpha = 1;
  lc.clearRect(0, 0, w, h);

  // 1) 顏料層：底色換成商品，明暗保留
  const k = pigmentK(base, (c2) => c2.fill(path, rule), color, x0, y0, w, h, key);
  lc.filter = 'brightness(' + k.toFixed(4) + ')';
  lc.drawImage(base, x0, y0, w, h, 0, 0, w, h);
  lc.filter = 'none';
  lc.translate(-x0, -y0);          // 之後 path 一律用原始畫布座標

  lc.globalCompositeOperation = 'color';
  lc.fillStyle = color;
  lc.fill(path, rule);

  // 1b) 依覆蓋率混回原本的臉：質地決定顏料層蓋得住多少。
  //     霧面唇膏顏料含量高、幾乎不透；水光唇釉是透的，看得到一部分原本的唇色。
  if (coverage < 1) {
    lc.globalCompositeOperation = 'source-over';
    lc.globalAlpha = 1 - coverage;
    lc.drawImage(base, x0, y0, w, h, x0, y0, w, h);   // translate 已生效，用原始座標
    lc.globalAlpha = 1;
  }

  // 2) 質地
  // 霧面不再額外壓暗：那層 multiply 是舊模型為了補強 'color' 才加的，
  // 顏料層模型已經直接把明度定在商品亮度上，再壓一次只會偏暗。
  if (finish === 'gloss') {
    // 水光：在下唇中央補一道高光
    const cx = (box.x0 + box.x1) / 2;
    const cy = box.y0 + (box.y1 - box.y0) * 0.68;
    const r  = (box.x1 - box.x0) * 0.30;
    const g  = lc.createRadialGradient(cx, cy, 0, cx, cy, Math.max(r, 4));
    g.addColorStop(0,   'rgba(255,255,255,0.62)');
    g.addColorStop(0.55,'rgba(255,255,255,0.16)');
    g.addColorStop(1,   'rgba(255,255,255,0)');
    lc.globalCompositeOperation = 'screen';
    lc.fillStyle = g;
    lc.fill(path, rule);
  } else if (finish === 'shimmer') {
    // 珠光：疊細顆粒
    lc.globalCompositeOperation = 'screen';
    lc.globalAlpha = 0.30;
    lc.fillStyle = lc.createPattern(getNoise(), 'repeat');
    lc.fill(path, rule);
    lc.globalAlpha = 1;
  }

  // 3) 羽化遮罩
  lc.globalCompositeOperation = 'destination-in';
  lc.filter = `blur(${blur}px)`;
  lc.fillStyle = '#fff';
  lc.fill(path, rule);
  lc.filter = 'none';

  // 3b) 嘴角收斂。真實唇彩在嘴角是漸薄的，不是像現在這樣
  //     整圈同一個羽化寬度 —— 均勻羽化會讓嘴角看起來腫一塊。
  if (taper) {
    lc.globalCompositeOperation = 'destination-out';
    for (const c of taper.corners) {
      const g = lc.createRadialGradient(c.x, c.y, 0, c.x, c.y, taper.r);
      g.addColorStop(0,    'rgba(0,0,0,0.80)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.32)');
      g.addColorStop(1,    'rgba(0,0,0,0)');
      lc.fillStyle = g;
      lc.fillRect(c.x - taper.r, c.y - taper.r, taper.r * 2, taper.r * 2);
    }
    lc.globalCompositeOperation = 'destination-in';
  }

  // 3c) 漸層唇（韓系內濃外淡）。用橢圓形的 alpha 衰減，
  //     不是圓形 —— 嘴唇是寬扁的，圓形漸層在嘴角會退得太快。
  if (grad) {
    lc.save();
    lc.translate(grad.cx, grad.cy);
    lc.scale(1, Math.max(grad.ry / grad.rx, 0.05));
    lc.translate(-grad.cx, -grad.cy);
    const g = lc.createRadialGradient(grad.cx, grad.cy, 0, grad.cx, grad.cy, grad.rx);
    g.addColorStop(0,    'rgba(0,0,0,1)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.95)');
    g.addColorStop(1,    'rgba(0,0,0,0.28)');
    lc.globalCompositeOperation = 'destination-in';
    lc.fillStyle = g;
    lc.fillRect(grad.cx - grad.rx * 1.5, grad.cy - grad.rx * 1.5, grad.rx * 3, grad.rx * 3);
    lc.restore();
  }

  // 4) 遮擋拒斥：再乘一層「亮度閘門」，暗於門檻的像素 alpha 歸零。
  //    destination-in 兩次會讓 alpha 相乘，正是我們要的。
  if (gate) {
    ensureLumFilter();
    lc.filter = gate;
    lc.drawImage(base, x0, y0, w, h, x0, y0, w, h);
    lc.filter = 'none';
  }

  lc.globalCompositeOperation = 'source-over';
  lc.setTransform(1, 0, 0, 1, 0, 0);

  dst.save();
  dst.globalAlpha = alpha;
  dst.drawImage(layer, 0, 0, w, h, x0, y0, w, h);
  dst.restore();
}

/** 腮紅：不用輪廓，用徑向漸層遮罩，邊緣更自然也更省效能 */
function paintBlush(dst, base, center, radius, { color, finish, alpha, coverage = 0, key = '' }) {
  if (alpha <= 0.001) return;
  const x0 = Math.max(0, Math.floor(center.x - radius));
  const y0 = Math.max(0, Math.floor(center.y - radius));
  const x1 = Math.min(base.width,  Math.ceil(center.x + radius));
  const y1 = Math.min(base.height, Math.ceil(center.y + radius));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;

  const layer = scratch(1, w, h);
  const lc = layer.getContext('2d');
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.globalCompositeOperation = 'source-over';
  lc.filter = 'none';
  lc.globalAlpha = 1;
  lc.clearRect(0, 0, w, h);

  const disc = (c2) => { c2.beginPath(); c2.arc(center.x, center.y, radius, 0, 6.2832); c2.fill(); };
  const k = pigmentK(base, disc, color, x0, y0, w, h, key);
  lc.filter = 'brightness(' + k.toFixed(4) + ')';
  lc.drawImage(base, x0, y0, w, h, 0, 0, w, h);
  lc.filter = 'none';
  lc.translate(-x0, -y0);

  const bx = center.x - radius, by = center.y - radius, bs = radius * 2;
  lc.globalCompositeOperation = 'color';
  lc.fillStyle = color;
  lc.fillRect(bx, by, bs, bs);

  if (coverage < 1) {
    lc.globalCompositeOperation = 'source-over';
    lc.globalAlpha = 1 - coverage;
    lc.drawImage(base, x0, y0, w, h, x0, y0, w, h);
    lc.globalAlpha = 1;
  }

  if (finish === 'shimmer') {
    lc.globalCompositeOperation = 'screen';
    lc.globalAlpha = 0.18;
    lc.fillStyle = lc.createPattern(getNoise(), 'repeat');
    lc.fillRect(bx, by, bs, bs);
    lc.globalAlpha = 1;
  }

  const g = lc.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
  g.addColorStop(0,    'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.65)');
  g.addColorStop(1,    'rgba(255,255,255,0)');
  lc.globalCompositeOperation = 'destination-in';
  lc.fillStyle = g;
  lc.fillRect(bx, by, bs, bs);
  lc.globalCompositeOperation = 'source-over';
  lc.setTransform(1, 0, 0, 1, 0, 0);

  dst.save();
  dst.globalAlpha = alpha;
  dst.drawImage(layer, 0, 0, w, h, x0, y0, w, h);
  dst.restore();
}

/**
 * 主渲染。base 必須是已經畫好素顏影像的 canvas。
 * config = { lip:{color,finish,amount}, eye:{...}, cheek:{...} }
 */
export function renderMakeup(dst, base, lm, config, opts = {}) {
  lumFrame++;
  const W = base.width, H = base.height;
  const scale = Math.min(W, H) / 480;
  // opts.fullCanvas 只給 _ar.html 的效能 A/B 用：強制回到「整張畫布」
  // 的處理方式，好量出邊界框最佳化實際省了多少。正式流程不會傳。
  const region = (b) => (opts.fullCanvas ? { x0: 0, y0: 0, x1: W, y1: H } : b);

  // 遮擋拒斥的亮度門檻。以 Step 2 量到的膚色明度（L* 0–100）為基準，
  // 所以深膚色不會被自己的膚色觸發拒斥 —— 用固定門檻的話就會。
  const ref = Math.max(0.15, Math.min(1, (config.refL ?? 70) / 100));
  // 門檻要壓在「明顯比該部位還暗」的位置。嘴唇天生就比皮膚暗（實測
  // 唇帶平均亮度約為膚色的 0.45 倍），用 ref×0.25~0.50 會讓整片唇正好
  // 落在閘門斜坡上，被當成半個遮擋物砍掉三分之一。
  // 實測定出這個區間：真人唇帶約為膚色亮度的 0.46 倍，深色頭髮約 0.12 倍。
  // 門檻要落在兩者之間 —— 原本的 0.25~0.50 上界壓到嘴唇身上（砍掉三分之一），
  // 一度改成 0.10~0.22 又太靠近頭髮（遮擋失效）。
  const gate = config.occlusion === false
    ? null
    : { lip: lumGate(ref * 0.16, ref * 0.30), eye: lumGate(ref * 0.14, ref * 0.28) };

  if (config.lip?.amount > 0) {
    const { path, box } = lipPath(lm, W, H);
    // 61 / 291 是左右嘴角
    const corners = [pt(lm, 61, W, H), pt(lm, 291, W, H)];
    const lipW = box.x1 - box.x0;
    paintRegion(dst, base, path, {
      color: config.lip.color, finish: config.lip.finish,
      alpha: config.lip.amount, blur: Math.max(1.5, 2.6 * scale), box: region(box),
      coverage: config.lip.coverage ?? COVERAGE.lip[config.lip.finish] ?? 0.9, key: 'lip',
      rule: 'evenodd',           // 外輪廓減內輪廓 → 口腔不上色
      gate: gate?.lip,
      taper: config.taper === false ? null : { corners, r: lipW * 0.15 },
      grad: config.lip.gradient
        ? { cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2,
            rx: lipW * 0.52, ry: (box.y1 - box.y0) * 0.95 }
        : null,
    });
  }

  if (config.eye?.amount > 0) {
    const blur = Math.max(3, 7 * scale);
    for (const [i, [u, a, b]] of [[EYE_R_UPPER, EYE_R_ALL, BROW_R], [EYE_L_UPPER, EYE_L_ALL, BROW_L]].entries()) {
      const { path, box } = eyeshadowPath(lm, W, H, u, a, b);
      paintRegion(dst, base, path, {
        color: config.eye.color, finish: config.eye.finish,
        alpha: config.eye.amount * 0.9, blur, box: region(box), gate: gate?.eye,
        coverage: config.eye.coverage ?? COVERAGE.eye[config.eye.finish] ?? 0.6, key: 'eye' + i,
      });
    }
  }

  if (config.cheek?.amount > 0) {
    const faceW = Math.abs(lm[454].x - lm[234].x) * W;
    const radius = faceW * 0.20;
    for (const [i, idx] of [CHEEK_R, CHEEK_L].entries()) {
      const c = centroid(idx.map((i) => pt(lm, i, W, H)));
      paintBlush(dst, base, c, radius, {
        color: config.cheek.color, finish: config.cheek.finish,
        alpha: config.cheek.amount * 0.55,
        coverage: config.cheek.coverage ?? COVERAGE.cheek[config.cheek.finish] ?? 0.4, key: 'cheek' + i,
      });
    }
  }
}

/** Step 1 的取景引導框用 */
export function faceBox(lm, W, H) {
  const xs = lm.map((p) => p.x * W), ys = lm.map((p) => p.y * H);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * 除錯疊層：把偵測到的關鍵點與各部位範圍畫出來。
 *
 * 「妝畫錯位置」有兩種可能 —— 關鍵點本身就抓錯，或是關鍵點對但
 * 渲染的座標換算錯。光看結果分不出來，畫出來就一目了然。
 * 由網址加上 ?debug 開啟。
 */
export function debugOverlay(ctx, lm, W, H) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // 全部關鍵點
  ctx.fillStyle = 'rgba(0,255,180,.55)';
  for (let i = 0; i < lm.length; i += 3) ctx.fillRect(lm[i].x * W - 1, lm[i].y * H - 1, 2, 2);

  // 各部位輪廓
  const ring = (idx, color) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.stroke(smoothPath(idx.map((i) => pt(lm, i, W, H))));
  };
  ring(LIPS_OUTER, '#ff3b6b');
  ring(LIPS_INNER, '#ffd166');
  ring(EYE_R_ALL, '#4dd8f5');
  ring(EYE_L_ALL, '#4dd8f5');

  // 腮紅中心與半徑
  const faceW = Math.abs(lm[454].x - lm[234].x) * W;
  ctx.strokeStyle = '#c084fc';
  for (const idx of [CHEEK_R, CHEEK_L]) {
    const c = centroid(idx.map((i) => pt(lm, i, W, H)));
    ctx.beginPath(); ctx.arc(c.x, c.y, faceW * 0.20, 0, Math.PI * 2); ctx.stroke();
  }

  // 臉寬基準線（234 ↔ 454）
  ctx.strokeStyle = '#ffffff88';
  ctx.beginPath();
  ctx.moveTo(lm[234].x * W, lm[234].y * H);
  ctx.lineTo(lm[454].x * W, lm[454].y * H);
  ctx.stroke();

  ctx.fillStyle = '#000c'; ctx.fillRect(4, H - 34, 300, 30);
  ctx.fillStyle = '#0f8'; ctx.font = '600 11px ui-monospace,monospace';
  ctx.fillText(`畫布 ${W}×${H}　關鍵點 ${lm.length}　臉寬 ${faceW.toFixed(0)}px`, 10, H - 14);
  ctx.restore();
}
