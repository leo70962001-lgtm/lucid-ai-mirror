/**
 * 化妝指導：化妝品 → 工具 → 手法，從粗到細
 *
 * 只給一張「AI 建議的成品照」對使用者一點用都沒有 —— 看得到結果，但不知道怎麼做到。
 * 真正要回答的是三件事：用什麼化妝品、用什麼工具、手怎麼動。
 * 手法又依手邊的工具分三種：
 *   full 工具齊全        用對應的刷具
 *   sub  工具不齊全      這個部位沒有對應工具，用替代品（棉花棒、化妝棉、粉撲）
 *   none 完全沒有工具    手指＋紙巾
 * 每個部位都分兩段：先粗（大範圍上色）→ 再細（收邊、暈開、對稱）。
 *
 * 這裡只有判斷與文案鍵，不碰畫面。文案在 i18n：
 *   coach.<part>.<method>.coarse / .fine、coach.<part>.tip、coach.tool.<tool>、coach.sub.<part>、coach.none.<part>
 */

export const COACH_PARTS = ['base', 'eye', 'cheek', 'lip'];
export const COACH_MODES = ['full', 'some', 'none'];
export const PART_TOOL = { base: 'sponge', eye: 'eyeBrush', cheek: 'blushBrush', lip: 'lipBrush' };
export const COACH_TOOLS = Object.values(PART_TOOL);
/** 先粗這一段先上到目標濃度的多少：看得到位置與範圍，但還沒完成 */
export const COARSE_RATIO = 0.55;

/** 這個部位該教哪一種手法。mode = some 時，有這支工具才算齊全 */
export function coachMethod(part, mode, owned = new Set(), hasSub = true) {
  if (mode === 'none') return 'none';
  if (mode === 'some' && !owned.has(PART_TOOL[part])) return hasSub ? 'sub' : 'none';
  return 'full';
}

/** 這個部位這種手法用什麼工具（文案鍵） */
export function coachToolKey(part, method) {
  if (method === 'none') return 'coach.none.' + part;
  if (method === 'sub') return 'coach.sub.' + part;
  return 'coach.tool.' + PART_TOOL[part];
}

/**
 * 整份指南：有哪幾個部位、各用哪支化妝品、什麼工具、先粗再細怎麼做。
 * 底妝不在商品目錄裡，用「你平常用的底妝」；沒有的品項或濃度是 0 的部位不列。
 */
export function coachPlan({ picks = null, amount = null, mode = 'full', owned = new Set(), hasSub = true } = {}) {
  const out = [];
  for (const part of COACH_PARTS) {
    const product = part === 'base' ? null : picks?.[part] || null;
    if (part !== 'base' && (!product || (amount?.[part] ?? 1) <= 0)) continue;
    const method = coachMethod(part, mode, owned, hasSub);
    out.push({
      part, product, method, toolKey: coachToolKey(part, method),
      coarseKey: `coach.${part}.${method}.coarse`, fineKey: `coach.${part}.${method}.fine`, tipKey: `coach.${part}.tip`,
    });
  }
  return out;
}

/* ── 把手法畫出來 ──────────────────────────────────────────
   用講的很難懂「從哪裡刷到哪裡」，所以直接畫在使用者自己的臉上：
     area 要上色的範圍、path 手要走的路線（有箭頭）、dot 要按壓的點
   座標用臉部點位算，人動、臉轉，圖跟著走。鏡子上是動畫，最後一頁的指南是同一份圖的靜態版。 */
export const COACH_GLYPH = { full: '🖌️', sub: '🧽', none: '👆' };
const EYES = [
  { up: [33, 246, 161, 160, 159, 158, 157, 173, 133], brow: [46, 53, 52, 65, 55], blend: [160, 53] },
  { up: [263, 466, 388, 387, 386, 385, 384, 398, 362], brow: [276, 283, 282, 295, 285], blend: [387, 283] },
];
const lerpPt = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

/** 這個部位、這一段（粗／細）要畫什麼。P：像素座標的臉部點位 */
export function coachShapes(part, stage, P) {
  const fw = Math.hypot(P[454].x - P[234].x, P[454].y - P[234].y) || 1;
  const pts = (ids) => ids.map((i) => P[i]);
  const path = (list) => ({ type: 'path', pts: list });
  const dot = (at, r = 0.022) => ({ type: 'dot', at, r: fw * r });
  const out = [];
  if (part === 'eye') {
    for (const e of EYES) {
      const lid = e.up.map((_, k) => {
        const b = P[e.brow[Math.round(k * (e.brow.length - 1) / (e.up.length - 1))]];
        return lerpPt(P[e.up[k]], b, 0.62);
      });
      if (stage === 'coarse') {
        out.push({ type: 'area', pts: [...pts(e.up), ...lid.slice().reverse()] });
        const mid = e.up.map((_, k) => lerpPt(P[e.up[k]], lid[k], 0.5)).reverse();
        out.push(path(mid));
      } else {
        out.push(path(pts(e.up).reverse()));           // 貼著睫毛根，由內往外
        out.push(path([P[e.blend[0]], lerpPt(P[e.blend[0]], P[e.blend[1]], 0.55)]));   // 邊界往上暈開
      }
    }
  } else if (part === 'cheek') {
    for (const [c, temple] of [[50, 127], [280, 356]]) {
      const end = lerpPt(P[c], P[temple], 0.72);
      if (stage === 'coarse') { out.push(dot(P[c], 0.03)); out.push(path([P[c], end])); }
      else {
        // 邊緣畫小圈，把界線刷開
        const m = lerpPt(P[c], end, 0.6), r = fw * 0.06;
        out.push(path(Array.from({ length: 21 }, (_, k) => ({ x: m.x + r * Math.cos(k * 0.6), y: m.y + r * 0.7 * Math.sin(k * 0.6) }))));
      }
    }
  } else if (part === 'lip') {
    if (stage === 'coarse') {
      const up = lerpPt(P[0], P[13], 0.5), lo = lerpPt(P[14], P[17], 0.5);
      for (const from of [up, lo]) for (const corner of [61, 291]) out.push(path([from, lerpPt(from, P[corner], 0.85)]));
    } else {
      out.push(path(pts([61, 185, 40, 39, 37, 0])), path(pts([291, 409, 270, 269, 267, 0])));   // 沿唇峰
      out.push(path(pts([61, 146, 91, 181, 84, 17])), path(pts([291, 375, 321, 405, 314, 17]))); // 沿下唇線
    }
  } else if (part === 'base') {
    if (stage === 'coarse') {
      for (const [from, to] of [[151, 10], [50, 234], [280, 454], [199, 152]]) {
        out.push(dot(P[from]));
        out.push(path([P[from], lerpPt(P[from], P[to], 0.7)]));
      }
      out.push(dot(P[4]));
    } else {
      for (const i of [129, 358, 61, 291, 119, 348]) out.push(dot(P[i], 0.018));
      out.push(path(pts([132, 58, 172, 136, 150, 149, 176, 148, 152])), path(pts([361, 288, 397, 365, 379, 378, 400, 377, 152])));
    }
  }
  return out;
}

/** 指南裡每張圖要框多大：眼看雙眼、頰與底妝看整張臉、唇看嘴（比例 4:3） */
export function coachRegion(part, P, W, H) {
  const ids = part === 'eye' ? [46, 276, 55, 285, 145, 374] : part === 'lip' ? [61, 291, 0, 17] : [234, 454, 10, 152];
  const xs = ids.map((i) => P[i].x), ys = ids.map((i) => P[i].y);
  const pad = part === 'lip' ? 0.5 : part === 'eye' ? 0.14 : 0.08;
  let w = (Math.max(...xs) - Math.min(...xs)) * (1 + pad * 2), h = (Math.max(...ys) - Math.min(...ys)) * (1 + pad * 2);
  if (w / h < 4 / 3) w = h * 4 / 3; else h = w * 3 / 4;
  if (w > W) { w = W; h = w * 3 / 4; }
  if (h > H) { h = H; w = h * 4 / 3; }
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  return { x: Math.max(0, Math.min(W - w, cx - w / 2)), y: Math.max(0, Math.min(H - h, cy - h / 2)), w, h };
}

/** 折線上走到 k（0..1）的位置 */
function pathAt(pts, k) {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  const total = seg.reduce((a, b) => a + b, 0) || 1;
  let left = total * Math.max(0, Math.min(1, k));
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i] || i === seg.length - 1) {
      const p = lerpPt(pts[i], pts[i + 1], seg[i] ? Math.min(1, left / seg[i]) : 0);
      return { p, i, prev: pts[i] };
    }
    left -= seg[i];
  }
  return { p: pts[pts.length - 1], i: pts.length - 2, prev: pts[pts.length - 2] };
}

/**
 * 畫出來。t = 動畫進度（0..1，手走到路線的哪裡）；t = null 是靜態圖（路線全部畫完、箭頭在終點）。
 * glyph：動畫時跟著路線走的工具（刷子、海綿、手指）。lw：線寬（像素）。
 */
export function drawCoachShapes(ctx, shapes, { lw = 3, t = null, glyph = '' } = {}) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = lw * 1.5;
  ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
  let tool = glyph;                    // 工具只畫一支：好幾支一起動太亂
  for (const s of shapes) {
    if (s.type === 'area') {
      ctx.beginPath();
      s.pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.save(); ctx.globalAlpha = 0.22; ctx.fill(); ctx.restore();
      ctx.save(); ctx.setLineDash([lw * 2, lw * 2]); ctx.lineWidth = lw * 0.6; ctx.stroke(); ctx.restore();
    } else if (s.type === 'dot') {
      const pulse = t == null ? 1 : 0.8 + 0.3 * Math.sin(t * Math.PI * 2);
      ctx.lineWidth = lw * 0.8;
      ctx.beginPath(); ctx.arc(s.at.x, s.at.y, s.r * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(s.at.x, s.at.y, lw * 0.7, 0, Math.PI * 2); ctx.fill();
    } else if (s.type === 'path') {
      const k = t == null ? 1 : t;
      // 整條路線淡淡的，走過的部分實線
      ctx.save(); ctx.globalAlpha = 0.45; ctx.setLineDash([lw * 1.6, lw * 2]); ctx.lineWidth = lw * 0.7;
      ctx.beginPath(); s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); ctx.restore();
      const at = pathAt(s.pts, k);
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(s.pts[0].x, s.pts[0].y);
      for (let i = 1; i <= at.i; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
      ctx.lineTo(at.p.x, at.p.y); ctx.stroke();
      // 箭頭
      const dir = Math.atan2(at.p.y - at.prev.y, at.p.x - at.prev.x), a = lw * 3.2;
      ctx.beginPath(); ctx.moveTo(at.p.x, at.p.y);
      ctx.lineTo(at.p.x - a * Math.cos(dir - 0.5), at.p.y - a * Math.sin(dir - 0.5));
      ctx.lineTo(at.p.x - a * Math.cos(dir + 0.5), at.p.y - a * Math.sin(dir + 0.5));
      ctx.closePath(); ctx.fill();
      if (tool && t != null) { drawTool(ctx, tool, at.p.x + lw * 2.5, at.p.y - lw, lw); tool = ''; }
    }
  }
  // 沒有路線的一步（沾取、點上）：工具在第一個點上輕輕上下
  if (tool && t != null) {
    const s = shapes.find((x) => x.type === 'dot') || shapes.find((x) => x.type === 'area');
    const at = s?.at || (s && { x: s.pts.reduce((a, p) => a + p.x, 0) / s.pts.length, y: s.pts.reduce((a, p) => a + p.y, 0) / s.pts.length });
    if (at) drawTool(ctx, tool, at.x + lw * 2.5, at.y - lw * (1 + 2.5 * Math.abs(Math.sin(t * Math.PI * 2))), lw);
  }
  ctx.restore();
}

/** 工具：文字（emoji）或畫好的圖示（圖片）；圖片的右下角對準筆尖 */
function drawTool(ctx, tool, x, y, lw) {
  ctx.save(); ctx.shadowBlur = 0;
  if (typeof tool === 'string') { ctx.font = (lw * 6) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(tool, x, y); }
  else if (tool.complete !== false && (tool.width || tool.naturalWidth)) { const z = lw * 14; ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = lw * 2; ctx.drawImage(tool, x - z * 0.15, y - z * 0.85, z, z); }
  ctx.restore();
}

/* ── 一步一步的畫法（化妝教學）────────────────────────────
   先粗、再細還太籠統，拆成手實際要做的幾個小步驟。每一步：
     id     文案鍵 teach.step.<part>.<id>
     stage  屬於先粗還是再細（目標圖用）
     upto   這一步做完，顏色到目標的幾成（示範時妝跟著工具一點一點出現）
   畫在臉上的圖取自 coachShapes，同一套座標。 */
export const TEACH_STEPS = {
  base: [{ id: 'dots', stage: 'coarse', upto: 0, motion: 'tap', reps: 1 }, { id: 'spread', stage: 'coarse', upto: 0, motion: 'stipple', reps: 1 },
         { id: 'detail', stage: 'fine', upto: 0, motion: 'tap', reps: 2 }, { id: 'edge', stage: 'fine', upto: 0, motion: 'stipple', reps: 1 }],
  eye: [{ id: 'load', stage: 'coarse', upto: 0, motion: 'tap', reps: 2 }, { id: 'lay', stage: 'coarse', upto: 0.55, motion: 'wiper', reps: 3 },
        { id: 'line', stage: 'fine', upto: 0.85, motion: 'line', reps: 1 }, { id: 'blend', stage: 'fine', upto: 1, motion: 'wiper', reps: 3 }],
  cheek: [{ id: 'load', stage: 'coarse', upto: 0, motion: 'tap', reps: 2 }, { id: 'place', stage: 'coarse', upto: 0.3, motion: 'tap', reps: 2 },
          { id: 'sweep', stage: 'coarse', upto: 0.8, motion: 'sweep', reps: 2 }, { id: 'blend', stage: 'fine', upto: 1, motion: 'circle', reps: 1 }],
  lip: [{ id: 'load', stage: 'coarse', upto: 0, motion: 'tap', reps: 1 }, { id: 'center', stage: 'coarse', upto: 0.3, motion: 'tap', reps: 2 },
        { id: 'spread', stage: 'coarse', upto: 0.75, motion: 'sweep', reps: 2 }, { id: 'upper', stage: 'fine', upto: 0.9, motion: 'line', reps: 1 },
        { id: 'lower', stage: 'fine', upto: 1, motion: 'line', reps: 1 }],
};
/** 手法：點拍、按壓推開、來回刷（雨刷）、往外刷、描線、畫小圈 */
export const TEACH_MOTIONS = ['tap', 'stipple', 'wiper', 'sweep', 'line', 'circle'];
/** 示範時每一小步的基本長度（毫秒）；要重複幾次的步驟給長一點，新手才看得清楚 */
export const TEACH_STEP_MS = 2800;
export const stepMs = (s) => TEACH_STEP_MS + Math.max(0, (s.reps || 1) - 1) * 900;

/** 這一小步要畫什麼 */
export function teachStepShapes(part, id, P) {
  const coarse = coachShapes(part, 'coarse', P), fine = coachShapes(part, 'fine', P);
  const of = (list, type) => list.filter((s) => s.type === type);
  if (part === 'base') {
    if (id === 'dots') return of(coarse, 'dot');
    if (id === 'spread') return of(coarse, 'path');
    if (id === 'detail') return of(fine, 'dot');
    return of(fine, 'path');
  }
  if (part === 'eye') {
    if (id === 'load') return of(coarse, 'area');
    if (id === 'lay') return coarse;
    return fine.filter((_, i) => (id === 'line' ? i % 2 === 0 : i % 2 === 1));   // 每隻眼：睫毛根一條、暈開一條
  }
  if (part === 'cheek') {
    if (id === 'load' || id === 'place') return of(coarse, 'dot');
    if (id === 'sweep') return of(coarse, 'path');
    return fine;
  }
  if (part === 'lip') {
    const fw = Math.hypot(P[454].x - P[234].x, P[454].y - P[234].y) || 1;
    if (id === 'load' || id === 'center') return [lerpPt(P[0], P[13], 0.5), lerpPt(P[14], P[17], 0.5)].map((at) => ({ type: 'dot', at, r: fw * 0.02 }));
    if (id === 'spread') return coarse;
    return id === 'upper' ? fine.slice(0, 2) : fine.slice(2);
  }
  return [];
}

/** 示範到第幾步、這一步走到哪：elapsed 毫秒 → { i, k（0..1）, done } */
export function demoAt(part, elapsed) {
  const st = TEACH_STEPS[part];
  let left = Math.max(0, elapsed);
  for (let i = 0; i < st.length; i++) {
    const ms = stepMs(st[i]);
    if (left < ms) return { i, k: left / ms, done: false };
    left -= ms;
  }
  return { i: st.length - 1, k: 1, done: true };
}
/** 第 i 步從示範的第幾毫秒開始（點清單跳到那一步） */
export function stepStart(part, i) {
  return TEACH_STEPS[part].slice(0, i).reduce((a, s) => a + stepMs(s), 0);
}
/** 示範時這個部位的顏色到目標的幾成：上一步做完的量 → 這一步做完的量 */
export function demoAmount(part, i, k) {
  const st = TEACH_STEPS[part], from = i ? st[i - 1].upto : 0, to = st[i].upto;
  const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;   // 起手慢、收尾慢
  return from + (to - from) * e;
}
/** 工具圖示：齊全用對應的刷具，替代品是棉花棒／化妝棉，沒有工具是手指 */
export function teachToolIcon(part, method) {
  return method === 'none' ? 'hand' : method === 'sub' ? 'cotton' : PART_TOOL[part];
}

/* ── 教學的畫法動畫：比指南的靜態圖更顯眼 ─────────────────────
   參考 AR 美妝教學的做法：只照亮要畫的地方、用化妝品的顏色畫範圍與筆跡、
   手法看得出來（點拍有漣漪、雨刷式來回、按壓一路彈）、好幾條路線一筆一筆輪流畫、點標上順序。 */

/** 聚光燈：這個部位的範圍（橢圓）。底妝是整張臉，不打聚光燈 */
export function teachSpot(part, P) {
  const fw = Math.hypot(P[454].x - P[234].x, P[454].y - P[234].y) || 1;
  const box = (ids, padX, padY) => {
    const xs = ids.map((i) => P[i].x), ys = ids.map((i) => P[i].y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, rx: (x1 - x0) / 2 + fw * padX, ry: (y1 - y0) / 2 + fw * padY };
  };
  if (part === 'lip') return [box([61, 291, 0, 17], 0.06, 0.06)];
  if (part === 'eye') return [box([33, 133, 46, 55, 145], 0.04, 0.04), box([263, 362, 276, 285, 374], 0.04, 0.04)];
  if (part === 'cheek') return [box([50, 127, 205, 117], 0.05, 0.05), box([280, 356, 425, 346], 0.05, 0.05)];
  return [];
}

const tri = (x) => { const m = x % 2; return m < 1 ? m : 2 - m; };
function strokeTo(ctx, pts, k) {
  const at = pathAt(pts, k);
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i <= at.i; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.lineTo(at.p.x, at.p.y);
  return at;
}
function arrowHead(ctx, tip, from, a) {
  const dir = Math.atan2(tip.y - from.y, tip.x - from.x);
  ctx.beginPath(); ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - a * Math.cos(dir - 0.5), tip.y - a * Math.sin(dir - 0.5));
  ctx.lineTo(tip.x - a * Math.cos(dir + 0.5), tip.y - a * Math.sin(dir + 0.5));
  ctx.closePath(); ctx.fill();
}

/**
 * 畫一小步。t = 這一步的進度（0..1），null = 靜態（路線畫完、沒有工具）。
 * color：化妝品的顏色。motion / reps：手法與次數。spot：聚光燈橢圓。W、H：畫布大小（聚光燈用）。
 */
export function drawTeachStep(ctx, shapes, { lw = 3, t = null, tool = null, color = '#e39aa8', motion = 'sweep', reps = 1, spot = null, W = 0, H = 0 } = {}) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const pulse = t == null ? 1 : 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * Math.max(1, reps));
  // 1. 聚光燈：其他地方暗下來，要畫的地方亮著、有一圈光
  if (spot?.length && W && H) {
    ctx.beginPath(); ctx.rect(0, 0, W, H);
    for (const e of spot) { ctx.moveTo(e.x + e.rx, e.y); ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, Math.PI * 2, true); }
    ctx.fillStyle = 'rgba(14,6,10,.46)'; ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.35 + 0.3 * pulse).toFixed(2) + ')'; ctx.lineWidth = lw * 0.7;
    for (const e of spot) { ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = lw * 1.4;
  const areas = shapes.filter((x) => x.type === 'area'), paths = shapes.filter((x) => x.type === 'path'), dots = shapes.filter((x) => x.type === 'dot');
  // 2. 範圍：化妝品的顏色，輕輕呼吸
  for (const s of areas) {
    ctx.beginPath(); s.pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    ctx.save(); ctx.shadowBlur = 0; ctx.globalAlpha = 0.18 + 0.2 * pulse; ctx.fillStyle = color; ctx.fill(); ctx.restore();
    ctx.save(); ctx.setLineDash([lw * 2, lw * 1.6]); ctx.lineWidth = lw * 0.7; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.restore();
  }
  // 3. 路線：先整條虛線＋終點箭頭（方向），再一筆一筆輪流畫上顏色
  let toolAt = null, bounce = 0;
  const n = paths.length, seg = t == null ? n : t * n, cur = Math.min(n - 1, Math.floor(seg)), kk = seg - cur;
  paths.forEach((s, j) => {
    ctx.save(); ctx.globalAlpha = 0.7; ctx.setLineDash([lw * 1.4, lw * 1.8]); ctx.lineWidth = lw * 0.8; ctx.strokeStyle = '#fff';
    ctx.beginPath(); s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#fff'; arrowHead(ctx, s.pts[s.pts.length - 1], s.pts[s.pts.length - 2], lw * 3);
    let q;
    if (t == null || j < cur) q = 1;
    else if (j > cur) return;
    else if (motion === 'wiper') q = tri(kk * reps * 2);
    else q = Math.min(1, (kk * reps) % 1 + (kk >= 0.999 ? 1 : 0));
    if (q <= 0) return;
    // 筆跡：化妝品顏色的粗線＋白色細芯
    ctx.save(); ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.85; ctx.strokeStyle = color; ctx.lineWidth = lw * 2.6; strokeTo(ctx, s.pts, motion === 'wiper' && j === cur ? Math.max(q, 0.0001) : q); ctx.stroke();
    ctx.globalAlpha = 0.9; ctx.strokeStyle = '#fff'; ctx.lineWidth = lw * 0.7; const at = strokeTo(ctx, s.pts, q); ctx.stroke();
    ctx.restore();
    if (t != null && j === cur) {
      toolAt = at.p;
      if (motion === 'stipple') bounce = Math.abs(Math.sin(q * Math.PI * 7)) * lw * 3;
    }
  });
  // 4. 點：標上順序；點拍時一個一個點，點下去有漣漪
  const nd = dots.length, dSeg = t == null ? nd : t * nd, dCur = Math.min(nd - 1, Math.floor(dSeg)), dk = dSeg - dCur;
  dots.forEach((s, j) => {
    const visited = t == null || j < dCur || (j === dCur && !n);
    ctx.save(); ctx.shadowBlur = 0;
    ctx.globalAlpha = visited ? 0.85 : 0.35; ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(s.at.x, s.at.y, s.r * 0.75, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.lineWidth = lw * 0.8; ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(s.at.x, s.at.y, s.r, 0, Math.PI * 2); ctx.stroke();
    if (nd > 1) {
      ctx.save(); ctx.shadowBlur = lw; ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(lw * 4.2) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(j + 1), s.at.x + s.r * 1.25, s.at.y - s.r * 1.25); ctx.restore();
    }
    if (t != null && !n && j === dCur) {
      const ph = (dk * Math.max(1, reps)) % 1;
      // 漣漪：點下去的那一下擴散
      ctx.save(); ctx.shadowBlur = 0; ctx.globalAlpha = 1 - ph; ctx.lineWidth = lw * 0.9; ctx.strokeStyle = color;
      ctx.beginPath(); ctx.arc(s.at.x, s.at.y, s.r * (1 + ph * 1.6), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      toolAt = s.at; bounce = Math.abs(Math.sin(ph * Math.PI)) * lw * 4;
    }
  });
  // 只有範圍（沾取）：工具在範圍中間點兩下
  if (t != null && !toolAt && areas.length) {
    const pts = areas[0].pts;
    toolAt = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    bounce = Math.abs(Math.sin(t * Math.PI * Math.max(1, reps))) * lw * 4;
  }
  // 5. 工具＋筆尖的小亮粉（化妝品的顏色）
  if (toolAt && tool) {
    ctx.save(); ctx.shadowBlur = 0;
    for (let i = 0; i < 5; i++) {
      const ang = i * 1.26 + t * 9, r = lw * (1.5 + ((t * 7 + i * 0.37) % 1) * 3);
      ctx.globalAlpha = 0.7 * (1 - ((t * 7 + i * 0.37) % 1)); ctx.fillStyle = i % 2 ? '#fff' : color;
      ctx.beginPath(); ctx.arc(toolAt.x + Math.cos(ang) * r, toolAt.y + Math.sin(ang) * r, lw * 0.55, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    drawTool(ctx, tool, toolAt.x + lw * 2.5, toolAt.y - lw - bounce, lw);
  }
  ctx.restore();
}
