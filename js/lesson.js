/**
 * 化妝教學（獨立的一段）：把鏡子裡的妝，搬到自己真的臉上
 *
 * 章節：工具 → 化妝品 → 底妝 → 眼影 → 腮紅 → 唇 → 完成。
 * 每個部位有兩種看法：
 *   看示範  鏡子上出現這一層，看它應該長什麼樣
 *   換我畫  虛擬的妝全部拿掉，鏡子是你真的臉，只留路線；你用真的化妝品跟著畫
 * 畫好按「幫我看看」：鏡頭量這個部位比開始時改變了多少，跟目標比。
 *
 * 量法：不是看顏色對不對（手邊的化妝品不一定是同一支），是看「上到多深」與「左右平不平均」。
 * 開始時先記一次，之後量到的都減掉額頭的變化 —— 燈光變亮變暗，額頭也會跟著變。
 * 這是鏡頭估的參考值，門檻還沒有用真人實測校正過。
 */
import { COACH_PARTS, PART_TOOL, coachShapes } from './coach.js';
import { rgbToLab } from './analysis.js';

/** 這次的章節：沒有的品項或濃度是 0 的部位不排；底妝一定有（鏡子不畫，用講的） */
export function lessonChapters({ picks = null, amount = null } = {}) {
  const out = [{ id: 'tools' }, { id: 'items' }];
  for (const part of COACH_PARTS) {
    if (part === 'base') { out.push({ id: part, part }); continue; }
    if (!picks?.[part] || (amount?.[part] ?? 1) <= 0) continue;
    out.push({ id: part, part, product: picks[part], amount: amount?.[part] ?? 0.5 });
  }
  out.push({ id: 'end' });
  return out;
}

/** 勾選的工具 → 手法。四支都有 = 齊全；什麼都沒有也沒有棉花棒 = 只用手指紙巾；其他 = 有的用、沒有的換替代品 */
export function modeFrom(owned, hasSub) {
  if (Object.values(PART_TOOL).every((t) => owned.has(t))) return 'full';
  if (!owned.size && !hasSub) return 'none';
  return 'some';
}

const midPt = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const LIP_OUT = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const LIP_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];

/** 要量哪裡：sides 是這個部位的區域（左右兩邊的依畫面由左到右排），ctrl 是對照用的額頭 */
export function lessonRegions(part, P) {
  const fw = Math.hypot(P[454].x - P[234].x, P[454].y - P[234].y) || 1;
  const ctrl = { circle: { ...P[151], r: fw * 0.05 } };
  const byX = (list, x) => list.slice().sort((a, b) => x(a) - x(b));
  if (part === 'lip') return { ctrl, sides: [{ poly: LIP_OUT.map((i) => P[i]), hole: LIP_IN.map((i) => P[i]) }] };
  if (part === 'cheek') {
    const c = [[50, 127], [280, 356]].map(([a, b]) => ({ circle: { ...midPt(P[a], P[b], 0.25), r: fw * 0.055 } }));
    return { ctrl, sides: byX(c, (s) => s.circle.x) };
  }
  if (part === 'eye') {
    const lids = coachShapes('eye', 'coarse', P).filter((s) => s.type === 'area').map((s) => ({ poly: s.pts }));
    return { ctrl, sides: byX(lids, (s) => s.poly[0].x) };
  }
  return null;
}

function inPoly(x, y, pg) {
  let r = false;
  for (let i = 0, j = pg.length - 1; i < pg.length; j = i++) {
    if ((pg[i].y > y) !== (pg[j].y > y) && x < (pg[j].x - pg[i].x) * (y - pg[i].y) / (pg[j].y - pg[i].y) + pg[i].x) r = !r;
  }
  return r;
}

/** 一個區域的平均顏色（Lab）；量不到回 null */
function regionLab(ctx, W, H, reg) {
  const pts = reg.circle ? [{ x: reg.circle.x - reg.circle.r, y: reg.circle.y - reg.circle.r }, { x: reg.circle.x + reg.circle.r, y: reg.circle.y + reg.circle.r }] : reg.poly;
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x)))), x1 = Math.min(W, Math.ceil(Math.max(...pts.map((p) => p.x))));
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y)))), y1 = Math.min(H, Math.ceil(Math.max(...pts.map((p) => p.y))));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    const hit = reg.circle ? (px - reg.circle.x) ** 2 + (py - reg.circle.y) ** 2 <= reg.circle.r ** 2 : inPoly(px, py, reg.poly) && !(reg.hole && inPoly(px, py, reg.hole));
    if (!hit) continue;
    const k = ((y - y0) * (x1 - x0) + (x - x0)) * 4;
    r += d[k]; g += d[k + 1]; b += d[k + 2]; n++;
  }
  return n >= 6 ? rgbToLab(r / n, g / n, b / n) : null;
}

/** 量一次這個部位（ctx 要是還沒疊上虛擬妝的畫面）。量不到回 null */
export function lessonSample(ctx, W, H, regions) {
  if (!regions) return null;
  const ctrl = regionLab(ctx, W, H, regions.ctrl), sides = regions.sides.map((s) => regionLab(ctx, W, H, s));
  return ctrl && sides.every(Boolean) ? { ctrl, sides } : null;
}

/** 幾次量測平均起來，手晃、臉動的雜訊比較小 */
export function averageSamples(list) {
  const ok = list.filter(Boolean);
  if (!ok.length) return null;
  const avg = (get) => {
    const v = ok.map(get);
    return { L: v.reduce((s, c) => s + c.L, 0) / v.length, a: v.reduce((s, c) => s + c.a, 0) / v.length, b: v.reduce((s, c) => s + c.b, 0) / v.length };
  };
  return { ctrl: avg((s) => s.ctrl), sides: ok[0].sides.map((_, i) => avg((s) => s.sides[i])) };
}

export const LESSON_LEVELS = { none: 0.25, light: 0.7, heavy: 1.4 };   // 走到目標的幾成算「還沒、偏淡、太濃」
const UNEVEN = 0.4, TOO_CLOSE = 3;      // 左右差超過四成算不平均；目標跟原本的差不到 3 就量不出來

/**
 * 上到幾成了。proj = 這一次的變化，落在「開始 → 目標」這條線上的比例（1 = 剛好）。
 * @param target 商品的 Lab  @param cov 覆蓋率（這個濃度下，顏色該蓋掉原本的幾成）
 * @returns level: small 量不出來 | none 還沒上 | light 偏淡 | good 差不多 | heavy 太濃；score 0–100；uneven 比較淡的那一邊（0 畫面左、1 畫面右）或 null
 */
export function assessPart(base, cur, target, cov) {
  const shift = { L: cur.ctrl.L - base.ctrl.L, a: cur.ctrl.a - base.ctrl.a, b: cur.ctrl.b - base.ctrl.b };
  const projs = base.sides.map((b0, i) => {
    const c = cur.sides[i];
    const v = { L: (target.L - b0.L) * cov, a: (target.a - b0.a) * cov, b: (target.b - b0.b) * cov };
    const len2 = v.L ** 2 + v.a ** 2 + v.b ** 2;
    if (Math.sqrt(len2) < TOO_CLOSE) return null;
    return ((c.L - shift.L - b0.L) * v.L + (c.a - shift.a - b0.a) * v.a + (c.b - shift.b - b0.b) * v.b) / len2;
  });
  if (projs.some((p) => p == null)) return { level: 'small', score: null, uneven: null };
  const mean = projs.reduce((a, b) => a + b, 0) / projs.length;
  const level = mean < LESSON_LEVELS.none ? 'none' : mean < LESSON_LEVELS.light ? 'light' : mean <= LESSON_LEVELS.heavy ? 'good' : 'heavy';
  const uneven = projs.length === 2 && Math.abs(projs[0] - projs[1]) > UNEVEN ? (projs[0] < projs[1] ? 0 : 1) : null;
  // 不夠的按比例算；超過扣得慢：真的口紅本來就比試妝的濃度顯色，塗滿不該只剩個位數
  const one = (p) => (p <= 1 ? 100 * Math.max(0, p) : 100 * Math.max(0, 1 - (p - 1) / 2));
  let score = projs.reduce((s, p) => s + one(p), 0) / projs.length;
  if (uneven != null) score -= 10;
  return { level, score: Math.max(0, Math.round(score)), uneven };
}
