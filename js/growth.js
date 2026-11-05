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
