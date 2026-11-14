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
  // 眼影的分區寫法：zones = [分區, 顏色角色, 編號]，paths = 手要走的路線，guides = 範圍上限的輔助線
  eye: [{ id: 'load', stage: 'coarse', upto: 0, motion: 'tap', reps: 2, zones: [['lid', 'base', 1]] },
        { id: 'lay', stage: 'coarse', upto: 0.55, motion: 'wiper', reps: 3, zones: [['lid', 'base', 1]], paths: ['lidMid'], guides: true },
        { id: 'line', stage: 'fine', upto: 0.85, motion: 'line', reps: 1, zones: [['band', 'deep', 2]], paths: ['lash'] },
        { id: 'blend', stage: 'fine', upto: 1, motion: 'wiper', reps: 3, zones: [['lid', 'base', 1], ['band', 'deep', 2]], paths: ['blendUp'] }],
  // 其他眼影畫法（參考小紅書新手眼影公式與「無眼影 3 步」）
  'eye.mono': [{ id: 'find', stage: 'coarse', upto: 0, motion: 'tap', reps: 1, zones: [['lid', 'main', 1]], guides: true },
               { id: 'lay', stage: 'coarse', upto: 0.7, motion: 'wiper', reps: 3, zones: [['lid', 'main', 1]], paths: ['lidMid'] },
               { id: 'edge', stage: 'fine', upto: 0.9, motion: 'sweep', reps: 2, zones: [['lid', 'main', 1]], paths: ['edge'] },
               { id: 'check', stage: 'fine', upto: 1, motion: 'tap', reps: 1, zones: [['lid', 'main', 1]] }],
  'eye.outer': [{ id: 'base', stage: 'coarse', upto: 0.4, motion: 'wiper', reps: 3, zones: [['lid', 'base', 1]], paths: ['lidMid'], guides: true },
                { id: 'place', stage: 'coarse', upto: 0.7, motion: 'tap', reps: 2, zones: [['lid', 'base', 1], ['outer', 'deep', 2]] },
                { id: 'blend', stage: 'fine', upto: 0.9, motion: 'sweep', reps: 2, zones: [['outer', 'deep', 2]], paths: ['outerIn'] },
                { id: 'lower', stage: 'fine', upto: 1, motion: 'line', reps: 1, zones: [['outer', 'deep', 2], ['lowOut', 'lower', 2]], paths: ['lowerOut'] }],
  // 腮紅畫法：斜向上（預設 cheek）、橫向、畫圈
  'cheek.flat': [{ id: 'load', stage: 'coarse', upto: 0, motion: 'tap', reps: 2, zones: [['flat', 'main', 1]] },
                 { id: 'place', stage: 'coarse', upto: 0.35, motion: 'tap', reps: 2, zones: [['flat', 'main', 1]], dots: ['high'] },
                 { id: 'sweep', stage: 'coarse', upto: 0.8, motion: 'sweep', reps: 2, zones: [['flat', 'main', 1]], paths: ['flatLine'] },
                 { id: 'blend', stage: 'fine', upto: 1, motion: 'circle', reps: 1, zones: [['flat', 'main', 1]], paths: ['flatEdge'] }],
  'cheek.apple': [{ id: 'load', stage: 'coarse', upto: 0, motion: 'tap', reps: 2, zones: [['apple', 'main', 1]] },
                  { id: 'smile', stage: 'coarse', upto: 0.3, motion: 'tap', reps: 2, zones: [['apple', 'main', 1]], dots: ['apple'] },
                  { id: 'circle', stage: 'coarse', upto: 0.85, motion: 'circle', reps: 2, zones: [['apple', 'main', 1]], paths: ['appleRing'] },
                  { id: 'blend', stage: 'fine', upto: 1, motion: 'tap', reps: 3, zones: [['apple', 'base', 1]], paths: ['appleEdge'] }],
  // 唇妝畫法：完整上色（預設 lip）、咬唇漸層、霧面描唇線
  'lip.gradient': [{ id: 'prep', stage: 'coarse', upto: 0, motion: 'tap', reps: 1, zones: [['lips', 'base', 1]] },
                   { id: 'core', stage: 'coarse', upto: 0.5, motion: 'tap', reps: 2, zones: [['core', 'core', 1]] },
                   { id: 'push', stage: 'fine', upto: 0.85, motion: 'sweep', reps: 2, zones: [['core', 'core', 1], ['lips', 'base', 2]], paths: ['outward'] },
                   { id: 'gloss', stage: 'fine', upto: 1, motion: 'tap', reps: 1, zones: [['core', 'shine', 1]] }],
  'lip.matte': [{ id: 'prep', stage: 'coarse', upto: 0, motion: 'tap', reps: 1, zones: [['lips', 'base', 1]] },
                { id: 'line', stage: 'coarse', upto: 0.2, motion: 'line', reps: 1, zones: [], paths: ['lipLine'], labels: ['lipline'] },
                { id: 'fill', stage: 'fine', upto: 0.9, motion: 'wiper', reps: 3, zones: [['lips', 'main', 1]], paths: ['fillIn'] },
                { id: 'blot', stage: 'fine', upto: 1, motion: 'tap', reps: 2, zones: [['lips', 'main', 1]] }],
  'eye.liner': [{ id: 'liner', stage: 'coarse', upto: 0, motion: 'line', reps: 1, zones: [], paths: ['linerExt'], labels: ['liner'] },
                { id: 'aegyo', stage: 'fine', upto: 0, motion: 'tap', reps: 2, zones: [['aegyoShade', 'shade', 1], ['aegyo', 'shine', 2]] },
                { id: 'lash', stage: 'fine', upto: 0, motion: 'sweep', reps: 1, zones: [], paths: ['lashTicks'], labels: ['lash'] }],
  cheek: [{ id: 'load', stage: 'coarse', upto: 0, motion: 'tap', reps: 2 }, { id: 'place', stage: 'coarse', upto: 0.3, motion: 'tap', reps: 2 },
          { id: 'sweep', stage: 'coarse', upto: 0.8, motion: 'sweep', reps: 2 }, { id: 'blend', stage: 'fine', upto: 1, motion: 'circle', reps: 1 }],
  lip: [{ id: 'load', stage: 'coarse', upto: 0, motion: 'tap', reps: 1 }, { id: 'center', stage: 'coarse', upto: 0.3, motion: 'tap', reps: 2 },
        { id: 'spread', stage: 'coarse', upto: 0.75, motion: 'sweep', reps: 2 }, { id: 'upper', stage: 'fine', upto: 0.9, motion: 'line', reps: 1 },
        { id: 'lower', stage: 'fine', upto: 1, motion: 'line', reps: 1 }],
};
/** 眼影畫法：雙色漸層（預設）、單色平鋪、眼尾加深、無眼影 3 步（眼線＋臥蠶＋睫毛） */
export const EYE_METHODS = ['duo', 'mono', 'outer', 'liner'];
export const eyeKey = (m) => (!m || m === 'duo' ? 'eye' : 'eye.' + m);
/** 各部位可以選的畫法（第一個是預設，用原本的步驟） */
export const PART_METHODS = { eye: EYE_METHODS, cheek: ['lift', 'flat', 'apple'], lip: ['full', 'gradient', 'matte'] };
export const methodKey = (part, m) => (!PART_METHODS[part] || !m || m === PART_METHODS[part][0] ? part : part + '.' + m);
/** 這個畫法量不量得到：無眼影 3 步沒有眼影色，鏡頭比對沒有意義 */
export const eyeMeasurable = (key) => TEACH_STEPS[key].some((st) => st.upto > 0);
/** 手法：點拍、按壓推開、來回刷（雨刷）、往外刷、描線、畫小圈 */
export const TEACH_MOTIONS = ['tap', 'stipple', 'wiper', 'sweep', 'line', 'circle'];
/** 示範時每一小步的基本長度（毫秒）；要重複幾次的步驟給長一點，新手才看得清楚 */
export const TEACH_STEP_MS = 2800;
export const stepMs = (s) => TEACH_STEP_MS + Math.max(0, (s.reps || 1) - 1) * 900;

/** 這一小步要畫什麼 */
export function teachStepShapes(part, id, P) {
  if (part === 'eye' || part.startsWith('eye.')) {
    const st = TEACH_STEPS[part]?.find((x) => x.id === id);
    if (st) return eyeStepShapes(st, P);
  }
  if (part.startsWith('cheek.') || part.startsWith('lip.')) {
    const st = TEACH_STEPS[part]?.find((x) => x.id === id);
    if (st) return part.startsWith('cheek.') ? cheekStepShapes(st, P) : lipStepShapes(st, P);
  }
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
  if (part === 'eye') return [box([33, 133, 46, 55, 145], 0.05, 0.065), box([263, 362, 276, 285, 374], 0.05, 0.065)];   // 下面留到臥蠶
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
export function drawTeachStep(ctx, shapes, { lw = 3, t = null, tool = null, color = '#e39aa8', motion = 'sweep', reps = 1, spot = null, W = 0, H = 0, labels = null } = {}) {
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
  const zones = shapes.filter((x) => x.type === 'zone'), guides = shapes.filter((x) => x.type === 'guide'), tags = shapes.filter((x) => x.type === 'tag');
  // 範圍上限：紅色虛線（眉頭→眼頭、眼尾平拉、眼眶骨）
  for (const g of guides) {
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = lw; ctx.strokeStyle = '#ff6b84'; ctx.lineWidth = lw * 1.1; ctx.setLineDash([lw * 2.4, lw * 1.5]);
    ctx.beginPath(); g.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); ctx.restore();
    if (g.label && labels) { const top = g.pts.reduce((m, p) => (p.y < m.y ? p : m), g.pts[0]); pill(ctx, labels[g.label] || g.label, top.x, top.y - lw * 5, lw, '#ff6b84'); }   // 標在眼眶骨最高點上方，不跟分區的字疊在一起
  }
  // 分區：用顏色角色填色、白色虛線框、編號；畫面左邊那隻眼拉一條引線寫「打底」「加深」
  for (const z of zones) {
    ctx.beginPath(); z.pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    ctx.save(); ctx.shadowBlur = 0; ctx.globalAlpha = 0.3 + 0.18 * pulse; ctx.fillStyle = roleColor(z.role, color); ctx.fill(); ctx.restore();
    ctx.save(); ctx.setLineDash([lw * 1.8, lw * 1.4]); ctx.lineWidth = lw * 0.7; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.restore();
  }
  for (const z of zones) {
    if (z.label && labels) {
      ctx.save(); ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = lw * 0.5;
      ctx.beginPath(); ctx.moveTo(z.c.x, z.c.y); ctx.lineTo(z.lp.x, z.lp.y); ctx.stroke(); ctx.restore();
      pill(ctx, (z.n ? z.n + ' ' : '') + (labels[z.role] || z.role), z.lp.x, z.lp.y, lw, roleColor(z.role, color));
    }
    if (z.n) badge(ctx, String(z.n), z.c.x, z.c.y, lw);
  }
  for (const g of tags) {
    if (!labels) continue;
    ctx.save(); ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = lw * 0.5;
    ctx.beginPath(); ctx.moveTo(g.at.x, g.at.y); ctx.lineTo(g.lp.x, g.lp.y); ctx.stroke(); ctx.restore();
    pill(ctx, labels[g.label] || g.label, g.lp.x, g.lp.y, lw, '#5b3944');
  }
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
  if (t != null && !toolAt && (areas.length || zones.length)) {
    const pts = (areas[0] || zones[0]).pts;
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

/* ── 眼睛的分區（小紅書圖解版的做法）────────────────────────────
   以睫毛根為 0、眉毛為 1 量高度，以眼尾為 0、眼頭為 1 量前後，分區都用這兩個比例切出來。
   zone 有顏色角色（打底、主色、加深、提亮…）、編號與引線文字；guide 是範圍上限的紅色虛線。 */
const LOW_LASH = [[33, 7, 163, 144, 145, 153, 154, 155, 133], [263, 249, 390, 373, 374, 380, 381, 382, 362]];
function along(arr, u) {
  const f = Math.max(0, Math.min(1, u)) * (arr.length - 1), i = Math.min(arr.length - 2, Math.floor(f));
  return lerpPt(arr[i], arr[i + 1], f - i);
}
function eyeGeo(P) {
  const fw = Math.hypot(P[454].x - P[234].x, P[454].y - P[234].y) || 1;
  return EYES.map((e, k) => {
    const lash = e.up.map((i) => P[i]);
    const brow = e.up.map((_, j) => P[e.brow[Math.round(j * (e.brow.length - 1) / (e.up.length - 1))]]);
    const at = (h) => lash.map((p, j) => lerpPt(p, brow[j], h));
    const low = LOW_LASH[k].map((i) => P[i]);
    const lowAt = (d) => low.map((p) => ({ x: p.x, y: p.y + fw * d }));
    return { k, fw, lash, at, low, lowAt, outer: lash[0], inner: lash[lash.length - 1], browIn: P[e.brow[e.brow.length - 1]] };
  });
}
const samples = (t0, t1, n = 8) => Array.from({ length: n + 1 }, (_, i) => t0 + (t1 - t0) * i / n);
function band(g, t0, t1, h0, h1) {
  const top = g.at(h1), bot = h0 > 0 ? g.at(h0) : g.lash;
  return [...samples(t0, t1).map((u) => along(top, u)), ...samples(t0, t1).reverse().map((u) => along(bot, u))];
}
function lowBand(g, t0, t1, d0, d1) {
  return [...samples(t0, t1).map((u) => along(g.lowAt(d0), u)), ...samples(t0, t1).reverse().map((u) => along(g.lowAt(d1), u))];
}
const ZONES = {
  lid: (g) => band(g, 0, 1, 0, 0.6),
  band: (g) => band(g, 0, 1, 0, 0.3),
  outer: (g) => band(g, 0, 0.38, 0, 0.55),
  lowOut: (g) => lowBand(g, 0, 0.38, 0.004, 0.034),
  aegyo: (g) => lowBand(g, 0.12, 0.85, 0.004, 0.026),
  aegyoShade: (g) => lowBand(g, 0.12, 0.85, 0.026, 0.04),
};
const PATHS = {
  lidMid: (g) => [samples(1, 0, 6).map((u) => along(g.at(0.3), u))],
  lash: (g) => [samples(1, 0, 6).map((u) => along(g.at(0.03), u))],
  blendUp: (g) => [[along(g.at(0.25), 0.5), along(g.at(0.62), 0.45)]],
  edge: (g) => [samples(0, 1, 6).map((u) => along(g.at(0.6), u))],
  outerIn: (g) => [[along(g.at(0.3), 0.05), along(g.at(0.35), 0.5)]],
  lowerOut: (g) => [samples(0, 0.38, 4).map((u) => along(g.lowAt(0.016), u))],
  linerExt: (g) => {
    const p = samples(1, 0, 6).map((u) => along(g.lash, u)), o = g.outer, q = along(g.lash, 0.15);
    const d = Math.hypot(o.x - q.x, o.y - q.y) || 1;
    return [[...p, { x: o.x + (o.x - q.x) / d * g.fw * 0.035, y: o.y + (o.y - q.y) / d * g.fw * 0.035 - g.fw * 0.01 }]];
  },
  lashTicks: (g) => samples(0.1, 0.9, 4).map((u) => { const a = along(g.lash, u), b = along(g.at(0.25), u); return [a, lerpPt(a, b, 0.6)]; }),
};
/** 眼睛的一小步：分區（顏色、編號、引線文字只標在畫面左邊那隻眼）、路線、範圍上限 */
export function eyeStepShapes(st, P) {
  const geo = eyeGeo(P), out = [];
  const leftIdx = geo[0].outer.x < geo[1].outer.x ? 0 : 1;
  for (const g of geo) {
    const lab = g.k === leftIdx, side = Math.sign(g.outer.x - g.inner.x) || -1;   // 引線往眼尾那側拉出去
    if (st.guides) {
      const lim = [
        { type: 'guide', pts: [g.browIn, g.inner] },                                                       // 眉頭 → 眼頭
        { type: 'guide', pts: [g.outer, { x: g.outer.x + side * g.fw * 0.09, y: g.outer.y - g.fw * 0.03 }] },  // 眼尾平拉
        { type: 'guide', pts: g.at(0.82), label: lab ? 'limit' : null },                                      // 眼眶骨
      ];
      out.push(...lim);
    }
    (st.zones || []).forEach(([z, role, n], i) => {
      const pts = ZONES[z](g);
      const c = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
      out.push({ type: 'zone', pts, role, n, c, label: lab ? role : null,
                 lp: { x: g.outer.x + side * g.fw * (0.12 + 0.02 * i), y: c.y + (i - (st.zones.length - 1) / 2) * g.fw * 0.085 } });
    });
    for (const pid of st.paths || []) for (const pts of PATHS[pid](g)) out.push({ type: 'path', pts });
    if (lab) for (const l of st.labels || []) {
      const p = l === 'liner' ? along(g.lash, 0.2) : along(g.at(0.2), 0.5);
      out.push({ type: 'tag', at: p, label: l, lp: { x: g.outer.x + side * g.fw * 0.12, y: p.y - g.fw * 0.02 } });
    }
  }
  return out;
}

/** 顏色角色：打底比化妝品淡、加深比它深、提亮是香檳色 */
function mixHex(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p, sh) => (p >> sh) & 255;
  const m = (sh) => Math.round(ch(pa, sh) + (ch(pb, sh) - ch(pa, sh)) * k);
  return '#' + ((m(16) << 16) | (m(8) << 8) | m(0)).toString(16).padStart(6, '0');
}
export function roleColor(role, color) {
  const c = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#c98f86';
  if (role === 'base') return mixHex(c, '#ffffff', 0.5);
  if (role === 'deep' || role === 'lower' || role === 'shade' || role === 'core') return mixHex(c, '#2a1414', 0.35);
  if (role === 'shine') return '#f2d9ac';
  return c;
}

/** 引線文字：深色底的小標籤（不會被眼妝的顏色吃掉） */
function pill(ctx, text, x, y, lw, dot) {
  ctx.save(); ctx.shadowBlur = 0;
  const fs = Math.max(11, lw * 5.6);
  ctx.font = '700 ' + fs + 'px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
  const w = ctx.measureText(text).width + fs * 1.4, h = fs * 1.5;
  const cw = ctx.canvas?.width || Infinity, x0 = Math.max(2, Math.min(cw - w - 2, x - w / 2));
  ctx.fillStyle = 'rgba(30,16,22,.78)';
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x0, y - h / 2, w, h, h / 2); else ctx.rect(x0, y - h / 2, w, h); ctx.fill();
  ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(x0 + fs * 0.62, y, fs * 0.28, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, x0 + fs * 1.05, y + fs * 0.04);
  ctx.restore();
}
/** 分區的編號：白底圓章 */
function badge(ctx, text, x, y, lw) {
  ctx.save(); ctx.shadowBlur = 0;
  const r = Math.max(6, lw * 2.6);
  ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5b3944'; ctx.font = '800 ' + (r * 1.25) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + r * 0.06);
  ctx.restore();
}

/* ── 腮紅與唇的分區（畫法選擇用）───────────────────────────── */
const ring = (c, rx, ry, rot = 0, n = 24) => Array.from({ length: n }, (_, i) => {
  const a = i / n * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry;
  return { x: c.x + x * Math.cos(rot) - y * Math.sin(rot), y: c.y + x * Math.sin(rot) + y * Math.cos(rot) };
});
const ptsCenter = (pts) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
function zoneShape(pts, role, n, label, lp) { return { type: 'zone', pts, role, n, c: ptsCenter(pts), label, lp }; }

/** 腮紅：微笑時的高點、往太陽穴、蘋果肌；左右各一 */
export function cheekStepShapes(st, P) {
  const fw = Math.hypot(P[454].x - P[234].x, P[454].y - P[234].y) || 1, out = [];
  const sides = [[50, 127, 205], [280, 356, 425]].map(([c, tp, ap]) => {
    const high = lerpPt(P[c], P[tp], 0.25), temple = lerpPt(P[c], P[tp], 0.72), apple = lerpPt(high, P[ap], 0.55);
    return { high, temple, apple, out: Math.sign(P[tp].x - P[c].x) || 1 };
  }).sort((a, b) => a.high.x - b.high.x);
  sides.forEach((sd, k) => {
    const lab = k === 0;
    const Z = {
      flat: ring({ x: sd.high.x, y: sd.high.y + fw * 0.025 }, fw * 0.1, fw * 0.042),
      apple: ring(sd.apple, fw * 0.055, fw * 0.05),
    };
    (st.zones || []).forEach(([z, role, n], i) => {
      const pts = Z[z], c = ptsCenter(pts);
      out.push(zoneShape(pts, role, n, lab ? role : null, { x: c.x + sd.out * fw * 0.16, y: c.y - fw * 0.06 * (i + 1) }));
    });
    const PTH = {
      flatLine: () => [[{ x: sd.high.x - sd.out * fw * 0.06, y: sd.high.y + fw * 0.025 }, { x: sd.high.x + sd.out * fw * 0.08, y: sd.high.y + fw * 0.022 }]],
      flatEdge: () => [ring({ x: sd.high.x + sd.out * fw * 0.07, y: sd.high.y + fw * 0.025 }, fw * 0.03, fw * 0.022, 0, 18).concat([])],
      appleRing: () => [ring(sd.apple, fw * 0.035, fw * 0.032, 0, 20)],
      appleEdge: () => [ring(sd.apple, fw * 0.06, fw * 0.055, 0, 28)],
    };
    for (const pid of st.paths || []) out.push(...PTH[pid]().map((pts) => ({ type: 'path', pts })));
    for (const d of st.dots || []) out.push({ type: 'dot', at: d === 'apple' ? sd.apple : sd.high, r: fw * 0.022 });
  });
  return out;
}

const LIP_O = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
/** 唇：整個唇、唇心（內側，咬唇的深色）、唇線 */
export function lipStepShapes(st, P) {
  const fw = Math.hypot(P[454].x - P[234].x, P[454].y - P[234].y) || 1, out = [];
  const lips = LIP_O.map((i) => P[i]), c = ptsCenter(lips);
  const core = lips.map((p) => lerpPt(c, p, 0.5));
  const lp = (i) => ({ x: Math.min(P[61].x, P[291].x) - fw * 0.12, y: c.y + (i - 0.5) * fw * 0.08 });
  (st.zones || []).forEach(([z, role, n], i) => out.push(zoneShape(z === 'core' ? core : lips, role, n, role, lp(i))));
  const PTH = {
    outward: () => [[61, 291, 0, 17].map((k) => [lerpPt(c, P[k], 0.35), lerpPt(c, P[k], 0.9)])].flat(),
    lipLine: () => [[61, 185, 40, 39, 37, 0], [291, 409, 270, 269, 267, 0], [61, 146, 91, 181, 84, 17], [291, 375, 321, 405, 314, 17]].map((ids) => ids.map((i) => P[i])),
    fillIn: () => [[lerpPt(c, P[61], 0.75), lerpPt(c, P[291], 0.75)]],
  };
  for (const pid of st.paths || []) out.push(...PTH[pid]().map((pts) => ({ type: 'path', pts })));
  for (const l of st.labels || []) out.push({ type: 'tag', at: P[61], label: l, lp: lp(0) });
  return out;
}
