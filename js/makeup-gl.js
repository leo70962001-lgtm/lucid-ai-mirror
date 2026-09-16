/**
 * 上妝渲染層 v2 —— UV 貼圖 + WebGL 網格變形
 *
 * 移植自 D:\ai\mirrorme-demo 的做法（演算法照抄，API 改成配合本專案的
 * product-first 商品目錄）。取代原本用 2D canvas 直接在臉上畫路徑的版本。
 *
 * 為什麼要換掉舊做法 —— 兩個結構性的問題：
 *
 * 1. 舊版用 canvas 的 'color' 混合，本質上只有「乘性」。
 *    乘法只能讓皮膚變暗，珠光、打亮、遮瑕在數學上就畫不出來。
 *    這裡改用 Yang et al.(EG 2023) 的三通道合成式：
 *        result = skin · blend + bias
 *    blend 是乘性色偏（顏料吸光），bias 是加性補光（珠光反光）。
 *
 * 2. 舊版是「平塗一塊顏色再模糊邊緣」。真實妝感的差別幾乎都在
 *    漸層的方向，不在顏色 —— 眼影從睫毛根部往眉骨淡出、漸層唇中心濃
 *    外緣淡、腮紅由中心向外散開。平塗加模糊看起來一定是假的。
 *    這裡每個部位都有自己的漸層軸。
 *
 * 妝容在 canonical face model 的 UV 空間裡定義「一次」，執行時用追蹤到的
 * 三角形把貼圖變形貼到當下這張臉，所以不需要為每種臉型各畫一套。
 */

import { FACE_MESH } from './face-mesh.js';

const TEX = 1024;

// ── 區域輪廓（landmark 索引，外側 → 內側）──────────────────
const UV_LIPS = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185];
const UV_LIPS_IN = [78,95,88,178,87,14,317,402,318,324,308,415,310,311,312,13,82,81,80,191];
const EYE_UP_L  = [33,246,161,160,159,158,157,173,133];
const EYE_UP_R  = [263,466,388,387,386,385,384,398,362];
const BROW_LO_L = [46,53,52,65,55];
const BROW_LO_R = [276,283,282,295,285];
const UV_CHEEK_L = 50,  UV_CHEEK_R = 280;      // 蘋果肌
const UV_EYEOUT_L = 33, UV_EYEOUT_R = 263;     // 腮紅往顴骨移動的方向

// 孔洞：眼球與口腔內側。
// 標準模型是閉眼閉嘴的中性臉，內唇與眼瞼輪廓在 UV 空間幾乎重疊，
// 所以「在貼圖上挖洞」沒有用 —— 使用者一張嘴，那些三角形就被拉開，
// 貼圖跟著糊到牙齒上。必須從索引緩衝把整個孔洞的三角形排除。
const EYE_RING_L = [33,246,161,160,159,158,157,173,133,155,154,153,145,144,163,7];
const EYE_RING_R = [263,466,388,387,386,385,384,398,362,382,381,380,374,373,390,249];
const HOLES = [UV_LIPS_IN, EYE_RING_L, EYE_RING_R].map((a) => new Set(a));

const solidTris = (() => {
  const keep = [];
  for (let i = 0; i < FACE_MESH.tri.length; i += 3) {
    const t = [FACE_MESH.tri[i], FACE_MESH.tri[i + 1], FACE_MESH.tri[i + 2]];
    if (!HOLES.some((h) => t.every((v) => h.has(v)))) keep.push(...t);
  }
  return new Uint16Array(keep);
})();

const SOFT_PX = { shadow: 50, lip: 24 };   // 柔和度 100 對應的模糊半徑

// ── 參數 ─────────────────────────────────────────────────
const blank = () => ({
  shadow: { on: false, color: '#A9736A', alpha: 42, extent: 62, grad: 78, soft: 40, bias: 18 },
  blush:  { on: false, color: '#DE8A81', alpha: 30, radius: 55, pos: 22, core: 15, bias: 10 },
  lip:    { on: false, color: '#B94A55', alpha: 62, grad: 0,  soft: 15, bias: 12 },
});

// 兩層妝：A 畫在分界線左邊，B 畫在右邊。
// 專櫃真的會這樣試色 —— 兩支色號同時上在同一張臉上，比記憶中的
// 「剛剛那支好像比較橘」可靠得多。B 關掉時 A 就畫滿整臉。
// 覆蓋率：質地決定顏料層有多「蓋得住」底色（再乘上使用者的濃度滑桿）。
// 霧面唇膏顏料含量高、幾乎不透；水光唇釉是透的，看得到一部分原本的唇色；
// 眼影可疊擦但單次不會全蓋；腮紅是刷開的薄霧。這張表是 App 與量測台共用的單一來源。
export const COVERAGE = {
  lip:   { matte: 0.92, gloss: 0.62, shimmer: 0.72 },
  eye:   { matte: 0.62, gloss: 0.50, shimmer: 0.55 },
  cheek: { matte: 0.42, gloss: 0.35, shimmer: 0.38 },
};
export const MODEL_NAME = '線性空間・反射率取代（顏料層）＋明暗保留＋眼白白平衡';

/** 質地。舊呼叫端只給 bias 數字，照舊的對應推回來 */
const finOf = (st) => st.finish || (st.bias >= 35 ? 'shimmer' : st.bias > 0 ? 'gloss' : 'matte');
/** bias 圖不再存顏色，而是存「這裡是什麼材質」：r 水光、g 珠光、b 是不是唇 */
const infoHex = (finish, lip) => '#' + [finish === 'gloss' ? 255 : 0, finish === 'shimmer' ? 255 : 0, lip ? 255 : 0]
  .map((v) => v.toString(16).padStart(2, '0')).join('');

// 光線：相機線性值 → 反射率的增益（眼白白平衡，由 app.js 每秒更新）
let gain = [1, 1, 1];
/** @param g 三通道增益；@param blend 0..1，與目前值的混合比例（即時更新時用小一點，避免閃爍） */
export function setLighting(g, blend = 1) {
  if (!Array.isArray(g) || g.length !== 3 || !g.every((v) => v > 0.3 && v < 4)) return false;
  gain = gain.map((v, i) => v + (g[i] - v) * blend);
  return true;
}
// 色卡校正矩陣（相機線性 → 標準線性）。沒有色卡時是單位矩陣，行為跟原本完全一樣。
let ccm = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], ccmInv = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const inv3 = (M) => {
  const [a, b, c] = M[0], [d, e, f] = M[1], [g, h, i] = M[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (!isFinite(det) || Math.abs(det) < 1e-9) return null;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
          [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
          [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
};
/** @param M 3×3（列優先）；null = 不用色卡；@param blend 即時更新時用小一點，避免整片跳色 */
export function setColorMatrix(M, blend = 1) {
  const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const target = M || I;
  const next = ccm.map((row, r) => row.map((v, c) => v + (target[r][c] - v) * blend));
  const inv = inv3(next);
  if (!inv) return false;
  ccm = next; ccmInv = inv;
  return true;
}
const mat3col = (M) => [M[0][0], M[1][0], M[2][0], M[0][1], M[1][1], M[2][1], M[0][2], M[1][2], M[2][2]];

// 唇與皮膚的平均反射率亮度（明暗 s 的基準）。每隔幾幀從畫面重新量一次
let yLip = 0.12, ySkin = 0.30, refFrame = 0, refReady = false;

const glState = blank();
const glStateB = blank();
let cur = glState;         // paint() 目前正在畫哪一層
let dualOn = false;

let intensity = 100;
let split = -1;            // −1 = 全臉；0..1 = 只在畫布左側這個比例內上妝
let sweep = -1;            // −1 = 關閉；0..1 = 上妝掃掠的前緣位置（UV v）
let texDirty = true, texDirtyB = true;

const applyTo = (st, next) => {
  for (const id of Object.keys(st)) {
    if (!next || !next[id]) { st[id].on = false; continue; }
    Object.assign(st[id], next[id]);
  }
};

/** 由外部（app.js）依商品目錄設定各部位。只寫入有給的欄位。 */
export function setMakeup(next) { applyTo(glState, next); texDirty = true; }

/** 第二層（分界線右側）。傳 null 就關掉，回到單層。 */
export function setMakeupB(next) {
  dualOn = !!next;
  if (next) applyTo(glStateB, next);
  texDirtyB = true;
}
export const isDual = () => dualOn;
export function setIntensity(v) { intensity = v; }
export function setSplit(v) { split = v; }
/** 上妝掃掠位置（UV 的 v，0–1 由上往下；負值 = 關閉） */
export function setSweep(v) { sweep = v; }

// ── UV 幾何工具 ──────────────────────────────────────────
const uvPt  = (i) => [FACE_MESH.uv[i * 2] * TEX, FACE_MESH.uv[i * 2 + 1] * TEX];
const lerpP = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const mean  = (idx) => {
  const s = idx.reduce((a, i) => { const p = uvPt(i); return [a[0] + p[0], a[1] + p[1]]; }, [0, 0]);
  return [s[0] / idx.length, s[1] / idx.length];
};
const rev = (a) => a.slice().reverse();
/** 把 n 點輪廓等距取樣成 m 點，用於讓眼睛與眉毛的點一一對應 */
const resample = (idx, m) =>
  Array.from({ length: m }, (_, i) => idx[Math.round(i * (idx.length - 1) / (m - 1))]);

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}
function pathPts(x, pts) {
  pts.forEach((p, k) => (k ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])));
  x.closePath();
}

// ── 在 UV 空間畫妝 ───────────────────────────────────────
// 產出兩張貼圖：
//   blend —— rgb 為色相、a 為覆蓋率，在著色器裡與膚色相乘
//   bias  —— 同樣形狀，但 a 再乘上「質地」，在著色器裡加到結果上
// 兩張共用同一套幾何與漸層，只差在 alpha 的縮放係數。
let texBlend = null, texBias = null;
const newCanvas = () => { const c = document.createElement('canvas'); c.width = c.height = TEX; return c; };

function paint(canvas, biasMode) {
  const x = canvas.getContext('2d');
  x.clearRect(0, 0, TEX, TEX);
  // 覆蓋率只放在 blend 圖的 alpha；bias 圖用同樣的形狀，但記的是「這裡是什麼材質」
  const k = () => 1;
  const col = (id) => (biasMode ? infoHex(finOf(cur[id]), id === 'lip') : cur[id].color);

  // 眼影：上緣在睫毛根部與眉骨之間插值，漸層由睫毛根部往上淡出
  const s = cur.shadow;
  if (s.on && k('shadow') > 0 && s.alpha > 0) {
    const a = s.alpha / 100 * k('shadow'), fade = s.grad / 100, ext = s.extent / 100;
    x.filter = `blur(${s.soft / 100 * SOFT_PX.shadow}px)`;
    for (const [eye, brow] of [[EYE_UP_L, BROW_LO_L], [EYE_UP_R, BROW_LO_R]]) {
      const eyePts = eye.map(uvPt);
      const anchor = resample(eye, brow.length).map(uvPt);
      const top = brow.map((bi, i) => lerpP(anchor[i], uvPt(bi), ext));
      const from = mean(eye), to = lerpP(from, mean(brow), Math.max(ext, 0.15));
      const g = x.createLinearGradient(from[0], from[1], to[0], to[1]);
      g.addColorStop(0, rgba(col('shadow'), a));
      g.addColorStop(1, rgba(col('shadow'), a * (1 - fade)));
      x.fillStyle = g;
      x.beginPath(); pathPts(x, eyePts.concat(rev(top))); x.fill();
    }
  }

  // 腮紅：位置可在蘋果肌與顴骨之間移動，中心集中度控制實心核的大小
  const bl = cur.blush;
  if (bl.on && k('blush') > 0 && bl.alpha > 0) {
    const a = bl.alpha / 100 * k('blush'), r = (bl.radius / 100) * TEX * 0.20, core = bl.core / 100;
    x.filter = 'none';
    for (const [cheek, toward] of [[UV_CHEEK_L, UV_EYEOUT_L], [UV_CHEEK_R, UV_EYEOUT_R]]) {
      const c = lerpP(uvPt(cheek), uvPt(toward), (bl.pos / 100) * 0.55);
      const g = x.createRadialGradient(c[0], c[1], 0, c[0], c[1], r);
      g.addColorStop(0, rgba(col('blush'), a));
      g.addColorStop(Math.min(0.95, core), rgba(col('blush'), a));
      g.addColorStop(1, rgba(col('blush'), 0));
      x.fillStyle = g; x.fillRect(c[0] - r, c[1] - r, r * 2, r * 2);
    }
  }

  // 唇：grad = 0 為滿版唇膏，拉高則變成中心濃、外緣淡的漸層唇
  const l = cur.lip;
  if (l.on && k('lip') > 0 && l.alpha > 0) {
    const a = l.alpha / 100 * k('lip'), grad = l.grad / 100;
    x.filter = `blur(${l.soft / 100 * SOFT_PX.lip}px)`;
    const pts = UV_LIPS.map(uvPt);
    const c = mean(UV_LIPS);
    const r = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
    const g = x.createRadialGradient(c[0], c[1], 0, c[0], c[1], r);
    g.addColorStop(0, rgba(col('lip'), a));
    g.addColorStop(1, rgba(col('lip'), a * (1 - grad)));
    x.fillStyle = g;
    x.beginPath(); pathPts(x, pts); x.fill();
  }

  x.filter = 'none';
  return canvas;
}

// ── 手動上妝：使用者自己拿虛擬刷具畫 ─────────────────────
// 筆觸存在 **UV 空間**，不是螢幕空間 —— 這是整件事成立的關鍵：
// 畫在 UV 上等於畫在臉上，頭一轉，妝跟著轉，不會黏在畫面上。
let userBlend = null, userBias = null, userInked = false;

const ensureUser = () => {
  if (!userBlend) { userBlend = newCanvas(); userBias = newCanvas(); }
};

/**
 * 螢幕座標 → UV。用臉部網格做重心座標插值：
 * 先找出點落在哪個三角形裡，再用同一組重心權重去插它的三個 UV。
 * 這是精確解，不是把臉當平面近似 —— 側臉與張嘴時才不會偏掉。
 */
export function screenToUV(P, px, py) {
  if (!FACE_MESH || !P) return null;
  const T = FACE_MESH.tri;
  for (let i = 0; i < T.length; i += 3) {
    const a = P[T[i]], b = P[T[i + 1]], c = P[T[i + 2]];
    if (!a || !b || !c) continue;
    if (px < Math.min(a.x, b.x, c.x) || px > Math.max(a.x, b.x, c.x)) continue;
    if (py < Math.min(a.y, b.y, c.y) || py > Math.max(a.y, b.y, c.y)) continue;
    const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(d) < 1e-9) continue;
    const w0 = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / d;
    const w1 = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / d;
    const w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const uv = (k) => [FACE_MESH.uv[T[i + k] * 2], FACE_MESH.uv[T[i + k] * 2 + 1]];
    const [u0, v0] = uv(0), [u1, v1] = uv(1), [u2, v2] = uv(2);
    return [u0 * w0 + u1 * w1 + u2 * w2, v0 * w0 + v1 * w1 + v2 * w2];
  }
  return null;   // 點在臉外
}

// 筆觸以「一筆」為單位記著，撤銷才有意義 —— 化妝的單位是一刷，不是一個像素。
// 撤銷時把剩下的筆觸重畫一遍，而不是存 1024² 的快照：
// 一張快照 4 MB，十步就 40 MB，而重畫一整條筆觸只要幾毫秒。
let strokes = [], redoStack = [];

export function beginStroke() { strokes.push([]); redoStack.length = 0; }
export const strokeCount = () => strokes.length;
export const redoCount = () => redoStack.length;

function replay() {
  if (userBlend) for (const c of [userBlend, userBias]) c.getContext('2d').clearRect(0, 0, TEX, TEX);
  for (const st of strokes) for (const d of st) stamp(d.u, d.v, d.o);
  userInked = strokes.some((st) => st.length > 0);
  texDirty = true;
}

export function undoStroke() {
  if (!strokes.length) return false;
  redoStack.push(strokes.pop());
  replay();
  return true;
}

export function redoStroke() {
  if (!redoStack.length) return false;
  strokes.push(redoStack.pop());
  replay();
  return true;
}

/** 疊一筆。alpha 刻意壓低，讓顏色靠反覆塗抹堆疊 —— 真的化妝就是這樣。 */
export function brushDab(u, v, o) {
  if (!strokes.length) beginStroke();
  strokes[strokes.length - 1].push({ u, v, o });
  stamp(u, v, o);
}

// ── 筆壓 ──────────────────────────────────────────────────
/**
 * 把 PointerEvent 回報的原始筆壓換算成「這一點要出多少力」。
 *
 * 有兩件事一定要分開處理：
 *
 * 1. **裝置根本不回報筆壓。** 規格規定不支援的裝置按下去是 0.5、放開是 0，
 *    滑鼠永遠落在這一類。這時只能當成滿壓 —— 照著 0.5 去乘，整個手動上妝
 *    會無緣無故淡掉一半，而且使用者完全不知道為什麼。所以 raw <= 0 一律回 1，
 *    「要不要相信這個值」由呼叫端先判斷完再傳進來。
 *
 * 2. **靈敏度 0 必須等於完全沒有筆壓這回事。** 櫃位機台大多是一般觸控螢幕，
 *    關掉之後行為要跟加筆壓之前逐位元組相同，不能只是「影響很小」。
 *
 * 曲線用 p^0.65 而不是線性：線性對應下輕輕帶過幾乎不顯色，
 * 但真實刷具輕壓本來就會上一層薄薄的。0.65 讓 0.1 的力道還有 0.22 的濃度。
 */
export function pressureLevel(raw, sens) {
  if (!(raw > 0)) return 1;                       // 沒有筆壓 → 當成滿壓
  const s = Math.min(1, Math.max(0, sens));
  const p = Math.min(1, raw) ** 0.65;
  return 1 - s + s * p;                            // sens = 0 → 恆為 1
}

/**
 * 筆壓對「一筆」的影響。
 *
 * 濃度是主角，半徑只跟一點點（0.62～1.0）—— 真實刷毛壓下去確實會散開，
 * 但如果讓半徑跟濃度一樣線性掉到 0，輕壓就會變成一個又小又淡的點，
 * 看起來像沒畫到而不是「畫得輕」。
 *
 * bias（珠光的加性補光）不用另外乘：stamp() 裡它本來就是 alpha * o，
 * 濃度乘下去珠光自然跟著淡。
 */
export function applyPressure(o, k) {
  return { ...o, alpha: o.alpha * k, radius: o.radius * (0.62 + 0.38 * k) };
}

function stamp(u, v, { color, alpha, radius, bias = 0, finish, lip = false }) {
  ensureUser();
  const cx = u * TEX, cy = v * TEX, r = Math.max(2, radius);
  const info = infoHex(finish || finOf({ bias }), lip);
  for (const [canvas, col] of [[userBlend, color], [userBias, info]]) {
    if (alpha <= 0) continue;
    const x = canvas.getContext('2d');
    const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, rgba(col, alpha));
    gr.addColorStop(0.55, rgba(col, alpha * 0.75));
    gr.addColorStop(1, rgba(col, 0));
    x.fillStyle = gr;
    x.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  userInked = true;
  texDirty = true;
}

export function clearBrush() {
  strokes = []; redoStack = [];
  if (userBlend) for (const c of [userBlend, userBias]) c.getContext('2d').clearRect(0, 0, TEX, TEX);
  userInked = false;
  texDirty = true;
}
export const hasBrush = () => userInked;

/**
 * 手繪層要不要參與合成。
 * Step 2 的妝容縮圖與 Step 3 的預覽是「這個妝容長什麼樣」，
 * 不該混進使用者自己畫的東西；Step 4 與 Step 5 的報告則相反 ——
 * 那是「他做了什麼」，手繪必須算進去。
 */
let brushOn = true;
export function useBrush(v) { if (brushOn !== v) { brushOn = v; texDirty = true; } }

function buildTextures() {
  cur = glState;
  if (!texBlend) { texBlend = newCanvas(); texBias = newCanvas(); }
  paint(texBlend, false);
  paint(texBias, true);
  if (userInked && brushOn) {
    // 手繪層疊在自動上妝之上，用同一套 blend / bias 慣例，
    // 所以兩者可以直接相加，著色器完全不必知道差別。
    texBlend.getContext('2d').drawImage(userBlend, 0, 0);
    texBias.getContext('2d').drawImage(userBias, 0, 0);
  }
  texDirty = false;
  return { blend: texBlend, bias: texBias };
}

let texBlendB = null, texBiasB = null;
function buildTexturesB() {
  cur = glStateB;
  if (!texBlendB) { texBlendB = newCanvas(); texBiasB = newCanvas(); }
  paint(texBlendB, false);
  paint(texBiasB, true);
  cur = glState;
  texDirtyB = false;
  return { blend: texBlendB, bias: texBiasB };
}

/** 給貼圖檢視 / 測試用 */
export function makeupTexture() { return buildTextures().blend; }

// ── WebGL：把 UV 貼圖依追蹤網格變形 ──────────────────────
let gl = null, glCanvas = null, prog = null, buf = {}, tex = null, pos = null, uploaded = false;

const VS = `attribute vec2 aPos; attribute vec2 aUV;
  varying vec2 vUV; varying vec2 vScr;
  void main(){
    vUV = aUV;
    vScr = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
    gl_Position = vec4(aPos, 0.0, 1.0);
  }`;

// ── 顏色模型：線性空間的「反射率取代」 ─────────────────────
// 舊版是 skin × 商品色（在 sRGB 裡乘）。那是一層「透明染料濾片」的物理：
// 唇本身的紅被算了兩次，每一支色號都變成「暗一點的唇色」。量測台（_color.html）
// 實測霧面唇膏上唇後與色卡平均差 ΔE00 12.8，色號之間的差異只剩四成。
//
// 唇膏、眼影、腮紅都是**不透明或半透明的顏料層**：看到的是顏料的反射率乘上
// 當下的光，不是皮膚的顏色再被乘一次。所以：
//   1. 相機值轉成線性，乘上眼白估出的增益 → 去掉環境光的「反射率」
//   2. 反射率亮度 ÷ 該區域平均亮度 = 這一點的明暗 s（受光面 > 1、陰影 < 1）
//   3. 妝 = 商品反射率 × s —— 底色換成商品，明暗與紋理原樣保留
//   4. 依覆蓋率（由質地決定，見 COVERAGE）與原本的反射率混合，除回增益、編回 sRGB
//   5. 水光：受光面加一層光源色的鏡面反射；珠光：光澤 + 固定在 UV 上的細閃
// 混合全部在著色器裡做，不交給 GL 的 alpha blending —— 那是在 sRGB 裡混，
// 而光的疊加必須在線性空間算。
const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  varying vec2 vUV; varying vec2 vScr;
  uniform sampler2D uBlend, uBias, uFrame;
  uniform float uAlpha, uLo, uHi, uSweep;
  uniform vec3 uGain;            // 相機線性值 → 反射率（眼白白平衡）
  uniform mat3 uCCM, uCCMInv;    // 色卡校正矩陣與反矩陣（沒有色卡時是單位矩陣）
  uniform float uYLip, uYSkin;   // 唇與皮膚的平均反射率亮度：明暗 s 的基準
  vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
  vec3 toSrgb(vec3 v) { v = clamp(v, 0.0, 1.0); return mix(v * 12.92, 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, v)); }
  void main(){
    // uLo..uHi 是這一趟要畫的畫面水平範圍（0..1）。
    // 單層時是整張臉；對比模式只畫分界線一側；雙色時左右各畫一趟。
    if (vScr.x < uLo || vScr.x > uHi) discard;
    vec4 m = texture2D(uBlend, vUV);          // rgb 商品色（sRGB）、a 覆蓋率
    vec4 f = texture2D(uBias,  vUV);          // r 水光鏡面、g 珠光、b 區域（1 = 唇）

    // 上妝掃掠：uSweep 是 UV 的 v（0 頭頂 → 1 下巴）。臉部 UV 剛好是
    // 眼 0.36 → 頰 0.48 → 唇 0.69，由上往下掃就是真實的上妝順序。
    float cover = 1.0, glow = 0.0;
    if (uSweep >= 0.0) {
      cover = 1.0 - smoothstep(uSweep, uSweep + 0.13, vUV.y);
      float d = (vUV.y - uSweep) / 0.05;
      glow = exp(-d * d);                      // 刷頭前緣的一道亮邊
    }
    float a = m.a * uAlpha * max(cover, glow * 0.8);
    if (a < 0.002) discard;                   // 沒上妝的地方一個位元都不改

    vec3 cam  = toLin(texture2D(uFrame, vScr).rgb);
    vec3 refl = uCCM * (cam * uGain);
    float Y   = dot(refl, vec3(0.2126, 0.7152, 0.0722));
    float s   = Y / max(mix(uYSkin, uYLip, f.b), 1e-4);
    vec3 P    = toLin(m.rgb);
    vec3 made = P * s;
    // 水光：透明上光層在受光面反射出光源的顏色（反射率空間裡就是白）
    made += vec3(f.r * 0.30 * smoothstep(1.05, 1.65, s));
    // 珠光：雲母在受光面帶出商品色的光澤，加上固定在 UV 上的細閃 —— 頭一轉，閃點跟著皮膚走
    float n = fract(sin(dot(floor(vUV * 640.0), vec2(12.9898, 78.233))) * 43758.5453);
    made += f.g * (P * 0.22 * smoothstep(0.85, 1.5, s) + vec3(0.35 * step(0.985, n) * s));

    vec3 outC = toSrgb(mix(cam, (uCCMInv * made) / uGain, a));
    outC += vec3(0.28 * glow) * a;
    gl_FragColor = vec4(outC, 1.0);
  }`;

function compile(type, src) {
  const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

function initGL(w, h) {
  glCanvas = document.createElement('canvas');
  glCanvas.width = w; glCanvas.height = h;
  gl = glCanvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true });
  if (!gl) return false;

  prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  pos = new Float32Array(FACE_MESH.vertexCount * 2);
  buf.pos = gl.createBuffer();
  buf.uv = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.uv);
  gl.bufferData(gl.ARRAY_BUFFER, FACE_MESH.uv, gl.STATIC_DRAW);
  buf.idx = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.idx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, solidTris, gl.STATIC_DRAW);

  const mkTex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
                          [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  };
  tex = { blend: mkTex(), bias: mkTex(), blendB: mkTex(), biasB: mkTex(), frame: mkTex() };

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  return true;
}

export function isGLReady() { return gl !== null || typeof document !== 'undefined'; }

/**
 * 把美妝層畫到目標 2D context 上。
 * @param ctx 目標 2D context（上面必須已經畫好素顏影像，它同時是膚色來源）
 * @param P   已鏡像的像素座標關鍵點陣列（至少 468 點）
 */
// 唇外輪廓／內輪廓（口縫）與兩頰取樣點（landmark 索引）
const REF_LIP_OUT = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185];
const REF_LIP_IN  = [78,95,88,178,87,14,317,402,318,324,308,415,310,311,312,13,82,81,80,191];
const lin1 = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function insidePoly(x, y, pg) {
  let r = false;
  for (let i = 0, j = pg.length - 1; i < pg.length; j = i++) {
    const [xi, yi] = pg[i], [xj, yj] = pg[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) r = !r;
  }
  return r;
}
/** 一個區域「亮度中段」（第 25–85 百分位）的平均反射率亮度 —— 避開高光與陰影 */
function midY(ctx, w, h, x0, y0, x1, y1, keep) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(w, Math.ceil(x1)); y1 = Math.min(h, Math.ceil(y1));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data, ys = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (!keep(x + 0.5, y + 0.5)) continue;
    const i = ((y - y0) * (x1 - x0) + (x - x0)) * 4;
    const v0 = lin1(d[i]) * gain[0], v1 = lin1(d[i + 1]) * gain[1], v2 = lin1(d[i + 2]) * gain[2];
    ys.push(0.2126 * (ccm[0][0] * v0 + ccm[0][1] * v1 + ccm[0][2] * v2)
          + 0.7152 * (ccm[1][0] * v0 + ccm[1][1] * v1 + ccm[1][2] * v2)
          + 0.0722 * (ccm[2][0] * v0 + ccm[2][1] * v1 + ccm[2][2] * v2));
  }
  if (ys.length < 12) return null;
  ys.sort((a, b) => a - b);
  const band = ys.slice(Math.floor(ys.length * 0.25), Math.ceil(ys.length * 0.85));
  return band.reduce((a, b) => a + b, 0) / band.length;
}
/** 從「還沒上妝」的畫面量唇與皮膚的基準亮度。每 8 幀一次，讀回的面積只有唇與兩小塊臉頰 */
function measureRefs(ctx, P, w, h) {
  if (refReady && (refFrame++ % 8)) return;
  const po = REF_LIP_OUT.map((i) => [P[i].x, P[i].y]), pi = REF_LIP_IN.map((i) => [P[i].x, P[i].y]);
  const xs = po.map((p) => p[0]), ys = po.map((p) => p[1]);
  const lip = midY(ctx, w, h, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys),
                   (x, y) => insidePoly(x, y, po) && !insidePoly(x, y, pi));
  const fw = Math.hypot(P[454].x - P[234].x, P[454].y - P[234].y), r = fw * 0.06;
  const cheeks = [50, 280].map((i) => midY(ctx, w, h, P[i].x - r, P[i].y - r, P[i].x + r, P[i].y + r,
                   (x, y) => (x - P[i].x) ** 2 + (y - P[i].y) ** 2 <= r * r)).filter((v) => v != null);
  const skin = cheeks.length ? cheeks.reduce((a, b) => a + b, 0) / cheeks.length : null;
  const k = refReady ? 0.4 : 1;          // 第一次直接用，之後平滑 —— 基準一跳，整片妝就跟著閃
  if (lip) yLip += (lip - yLip) * k;
  if (skin) ySkin += (skin - ySkin) * k;
  if (lip || skin) refReady = true;
}
/** 換一張照片（Step 2 縮圖、評價頁對照圖）時要重新量，不能沿用即時畫面的基準 */
export function resetRefs() { refReady = false; refFrame = 0; }

export function renderGL(ctx, P, w, h) {
  if (!FACE_MESH || !P || P.length < FACE_MESH.vertexCount) return false;
  if (!gl && initGL(w, h) === false) return false;
  if (glCanvas.width !== w || glCanvas.height !== h) { glCanvas.width = w; glCanvas.height = h; }
  if (!glState.lip.on && !glState.shadow.on && !glState.blush.on && !dualOn && !userInked) return true;

  if (texDirty || !uploaded) {
    const t = buildTextures();
    for (const [unit, src] of [[tex.blend, t.blend], [tex.bias, t.bias]]) {
      gl.bindTexture(gl.TEXTURE_2D, unit);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    }
    uploaded = true;
  }
  if (dualOn && texDirtyB) {
    const t = buildTexturesB();
    for (const [unit, src] of [[tex.blendB, t.blend], [tex.biasB, t.bias]]) {
      gl.bindTexture(gl.TEXTURE_2D, unit);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    }
  }
  // 膚色來源：當下的 2D 畫布
  gl.bindTexture(gl.TEXTURE_2D, tex.frame);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas);

  for (let i = 0; i < FACE_MESH.vertexCount; i++) {
    pos[i * 2]     = P[i].x / w * 2 - 1;
    pos[i * 2 + 1] = 1 - P[i].y / h * 2;
  }

  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(prog);

  const aPos = gl.getAttribLocation(prog, 'aPos'), aUV = gl.getAttribLocation(prog, 'aUV');
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos);
  gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.uv);
  gl.enableVertexAttribArray(aUV); gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1f(gl.getUniformLocation(prog, 'uAlpha'), intensity / 100);
  gl.uniform1f(gl.getUniformLocation(prog, 'uSweep'), sweep);
  measureRefs(ctx, P, w, h);
  gl.uniform3f(gl.getUniformLocation(prog, 'uGain'), gain[0], gain[1], gain[2]);
  gl.uniformMatrix3fv(gl.getUniformLocation(prog, 'uCCM'), false, mat3col(ccm));
  gl.uniformMatrix3fv(gl.getUniformLocation(prog, 'uCCMInv'), false, mat3col(ccmInv));
  gl.uniform1f(gl.getUniformLocation(prog, 'uYLip'), yLip);
  gl.uniform1f(gl.getUniformLocation(prog, 'uYSkin'), ySkin);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.idx);

  const edge = split >= 0 ? split : 1.0;
  const pass = (blend, bias, lo, hi) => {
    gl.uniform1f(gl.getUniformLocation(prog, 'uLo'), lo);
    gl.uniform1f(gl.getUniformLocation(prog, 'uHi'), hi);
    for (const [i, [name, t]] of [['uBlend', blend], ['uBias', bias], ['uFrame', tex.frame]].entries()) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(gl.getUniformLocation(prog, name), i);
    }
    gl.drawElements(gl.TRIANGLES, solidTris.length, gl.UNSIGNED_SHORT, 0);
  };

  if (dualOn) {
    // 雙色：分界線左右各一支色號。分界線由使用者拖曳。
    pass(tex.blend,  tex.bias,  -0.01, edge);
    pass(tex.blendB, tex.biasB, edge,  1.01);
  } else {
    pass(tex.blend, tex.bias, -0.01, split >= 0 ? split : 1.01);
  }

  ctx.drawImage(glCanvas, 0, 0);   // 乘性與加性都已在著色器裡算完
  return true;
}
