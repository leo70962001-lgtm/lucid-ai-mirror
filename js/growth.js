/**
 * 我的成長紀錄：每次練習留下分數（可選擇連前後照片），看得到自己的技術在進步
 *
 * 只存在這台裝置（localStorage），不會上傳。照片要使用者勾了才存，而且只留最近幾次 ——
 * 機台可能很多人共用，可以隨時整份刪掉。存取在 app.js；這裡只有不碰畫面的判斷。
 */
export const GROWTH_KEY = 'lucid.growth';
export const GROWTH_PARTS = ['eye', 'cheek', 'lip'];
const MAX_RECORDS = 30, MAX_PHOTOS = 12;

/** 加一筆（新的在最後）。太舊的整筆丟掉；照片只留最近幾筆，分數留著 */
export function addRecord(list, rec, { max = MAX_RECORDS, photoMax = MAX_PHOTOS } = {}) {
  const next = [...(list || []), rec].slice(-max);
  let photos = 0;
  for (let i = next.length - 1; i >= 0; i--) {
    if (!next[i].before && !next[i].after) continue;
    if (++photos > photoMax) next[i] = { ...next[i], before: null, after: null };
  }
  return next;
}

/** 某個部位歷次的分數（只算有量到的） */
export function growthTrend(list, part) {
  return (list || []).filter((r) => r.scores?.[part] != null).map((r) => ({ at: r.at, score: r.scores[part] }));
}

/** 這次比上次進步多少；只有一次就是 null */
export function growthDelta(list, part) {
  const t = growthTrend(list, part);
  return t.length < 2 ? null : t[t.length - 1].score - t[t.length - 2].score;
}

/** 小折線的座標：縱軸固定 0–100（三個部位同一把尺才比得起來），橫軸照次數平均分 */
export function sparkPoints(trend, w, h, pad = 6) {
  const n = trend.length;
  return trend.map((p, i) => ({
    x: n === 1 ? w / 2 : pad + (w - pad * 2) * i / (n - 1),
    y: h - pad - (h - pad * 2) * Math.max(0, Math.min(100, p.score)) / 100,
    score: p.score, at: p.at,
  }));
}

/* ── 練完的分析：下次怎麼做會更好 ──────────────────────────
   只看手上的動作（太深、太淡、左右不一樣、跟上次比），不評論長相。
   每一條建議連到該重練的那一步（TEACH_STEPS 的 id），畫面上會附那一步的圖解。 */
/** 要重練哪一步：太深 → 取色（量的問題）；太淡 → 主要上色那步；左右不一樣 → 推開／暈開那步 */
export const FIX_STEP = {
  eye: { heavy: 'load', light: 'lay', none: 'lay', uneven: 'blend' },
  cheek: { heavy: 'load', light: 'place', none: 'place', uneven: 'sweep' },
  lip: { heavy: 'load', light: 'spread', none: 'center', uneven: 'spread' },
};

/**
 * @param results 這次各部位的量測 { eye: { level, score, uneven } … }（沒量到的不放）
 * @param prev    之前的紀錄（不含這次）
 * @param planned 這次有教的部位（用來提醒沒量到的）
 * @returns 依重要性排好的建議：fix 要修的 → up/down 跟上次比 → focus 下次先練 → keep 保留的 → check 沒量到
 */
export function practiceAdvice(results = {}, prev = [], planned = []) {
  const out = [];
  const parts = GROWTH_PARTS.filter((p) => results[p]?.score != null);
  for (const p of parts) {
    const r = results[p];
    // tip：網路上新手教學整理出來的小技巧（i18n 的 adv2.tip.*）
    if (r.uneven != null) out.push({ kind: 'fix', part: p, key: 'adv2.uneven', side: r.uneven, step: FIX_STEP[p].uneven, tip: 'adv2.tip.' + p + '.uneven' });
    else if (r.level === 'heavy') out.push({ kind: 'fix', part: p, key: 'adv2.heavy.' + p, step: FIX_STEP[p].heavy, tip: 'adv2.tip.' + p + '.heavy' });
    else if (r.level === 'light' || r.level === 'none') out.push({ kind: 'fix', part: p, key: 'adv2.light.' + p, step: FIX_STEP[p][r.level], tip: 'adv2.tip.' + p + '.light' });
  }
  for (const p of parts) {
    const before = growthTrend(prev, p);
    if (!before.length) continue;
    const d = results[p].score - before[before.length - 1].score;
    if (d >= 5) out.push({ kind: 'up', part: p, key: 'adv2.up', d });
    else if (d <= -5) out.push({ kind: 'down', part: p, key: 'adv2.down', d });
  }
  if (parts.length > 1) {
    const low = parts.reduce((a, b) => (results[b].score < results[a].score ? b : a));
    if (results[low].score < 80) out.push({ kind: 'focus', part: low, key: 'adv2.focus', tip: 'adv2.tip.pace' });
  }
  for (const p of parts) if (results[p].level === 'good' && results[p].uneven == null) out.push({ kind: 'keep', part: p, key: 'adv2.good' });
  const missed = planned.filter((p) => GROWTH_PARTS.includes(p) && results[p]?.score == null);
  if (missed.length) out.push({ kind: 'check', parts: missed, key: parts.length ? 'adv2.check' : 'adv2.none' });
  const rank = { fix: 0, up: 1, down: 2, focus: 3, keep: 4, check: 5 };
  return out.map((x, i) => [x, i]).sort((a, b) => rank[a[0].kind] - rank[b[0].kind] || a[1] - b[1]).map((x) => x[0]);
}
