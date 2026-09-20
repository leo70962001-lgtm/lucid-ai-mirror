/**
 * 唇色知識與喜好學習
 *
 * 兩件事：
 *   1. 把一支唇膏講成人話 —— 屬於哪個色系（正紅、莓果、豆沙、珊瑚、裸色…）、什麼質地、偏深還偏淺。
 *      色系由實測色值分，不靠人工標；顧客能聽懂的字，才幫得上挑色。
 *   2. 學今天這個人的喜好 —— 不只記「冷暖」，還記「深淺、鮮豔、質地」四個方向。
 *      依據是停留時間與親自點選：停得久、自己挑的，權重比較高。學到的東西要講得出來，
 *      不然就只是偷偷改推薦。
 *
 * 實體唇膏的常識（也放進小教室，見 js/learn.js）：
 *   - 唇膏是疊在「原本就有血色的唇」上，所以同一支在不同人唇上不會一樣；唇色深要更飽和或先遮色。
 *   - 質地決定印象：霧面顏色最準、最成熟，但會放大唇紋；水光／唇釉飽滿有光澤，疊越多越明顯；
 *     透明感（sheer）最好上手，顏色淡淡的。
 *   - MLBB（My Lips But Better）＝ 比原本唇色好看一點點的自然色，最不容易出錯。
 *
 * 參考：
 *   Bobbi Brown 台灣「口紅色號怎麼選」https://www.bobbibrown.com.tw/makeup-guide/lipsticks-choosing-tips
 *   YSL 台灣「口紅顏色怎麼選？根據膚色、唇色、妝感」https://www.yslbeauty.com.tw/seo-makeup-3.html
 *   Visée（コーセー）「リップの種類と違い」https://www.kose.co.jp/visee/lip/type/
 *   ちふれ「パーソナルカラー別おすすめリップ」https://www.chifure.co.jp/kirei/useful/season/13
 */

import { rgbToLab } from './analysis.js';

const lipLab = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
};
/** 一支唇膏的三個量：色相角、彩度、明度 */
export function lipMetrics(p) {
  const lab = lipLab(p.color);
  return { h: ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360, C: Math.hypot(lab.a, lab.b), L: lab.L };
}

/**
 * 色系：先看彩度（淡的都是裸色家族），再看色相，最後用明度分深淺。
 * 門檻是照店裡這批色號與常見分類（正紅／莓果／豆沙／珊瑚／裸色…）對出來的，
 * 不是產業標準 —— 換一批商品要重看一次。
 */
export const LIP_FAMILIES = ['nude', 'mocha', 'berry', 'pink', 'trueRed', 'rosewood', 'rose', 'brick', 'coral', 'orange'];

export function lipFamily(p) {
  if (!p?.color) return null;
  const { h, C, L } = lipMetrics(p);
  if (C < 28) return L >= 58 ? 'nude' : 'mocha';            // 裸色／奶茶棕
  if (h < 12) return L < 50 ? 'berry' : 'pink';             // 莓果紫紅／桃粉
  if (h < 28) {
    if (C >= 55) return 'trueRed';                          // 正紅
    return L <= 58 ? 'rosewood' : 'rose';                   // 豆沙／玫瑰
  }
  if (h < 45) return L < 55 ? 'brick' : 'coral';            // 磚紅／珊瑚
  return C > 40 ? 'orange' : 'mocha';                       // 橘／焦糖棕
}

/** 深淺（給人聽的字）：唇色深淺會影響發色，所以要講出來 */
export const lipDepth = (p) => { const { L } = lipMetrics(p); return L >= 62 ? 'light' : L >= 50 ? 'mid' : 'deep'; };

const lipLine = (kind, key, params) => ({ kind, key, params: params || {} });

/** 一句話介紹這支：色系＋質地＋深淺，再加一句這個色系的特徵 */
export function describeLip(p) {
  const fam = lipFamily(p);
  if (!fam) return [];
  return [lipLine('fact', 'adv.lip.desc', { shade: p.id, family: 'lipfam.' + fam, finish: 'finish.' + p.finish, depth: 'lipdepth.' + lipDepth(p) }),
          lipLine('tip', 'lipfam.' + fam + '.say', {})];
}

/** 質地的差別（小教室與「這支是什麼」都用得到） */
export const finishNote = (finish) => [lipLine('tip', 'adv.lip.finish.' + (finish === 'gloss' ? 'gloss' : finish === 'matte' ? 'matte' : 'shimmer'), {})];

// ── 喜好學習 ───────────────────────────────────────────
// 四個方向都是 −1…+1：暖↔冷、深↔淺、鮮豔↔柔和，質地另外記次數。
// 權重：停留時間（每 DWELL 秒算 1，最多 3）、親自點選的色號再加 1.5 ——
// 「看很久」跟「自己挑」都是喜歡，但自己挑更明確。

export function newTaste() { return { obs: [], finish: {} }; }

export function noteTaste(taste, product, { ms = 0, picked = false, dwellMs = 2500 } = {}) {
  if (!taste || !product) return taste;
  const w = Math.min(3, ms / dwellMs) + (picked ? 1.5 : 0);
  if (w < 0.5) return taste;                               // 只是掃過去的不算
  const { h, C, L } = lipMetrics(product);
  taste.obs.push({
    id: product.id, w,
    warm: Math.max(-1, Math.min(1, (h - 24) / 16)),        // 色相 24° 附近算中性，往上偏暖、往下偏冷
    deep: Math.max(-1, Math.min(1, (52 - L) / 12)),
    vivid: Math.max(-1, Math.min(1, (C - 42) / 14)),
  });
  taste.finish[product.finish] = (taste.finish[product.finish] || 0) + w;
  return taste;
}

/** 目前學到的樣子。看過的色號少於 2 支就不下結論 —— 一支不能代表喜好 */
export function tasteRead(taste) {
  const obs = taste?.obs || [];
  const ids = new Set(obs.map((o) => o.id));
  if (ids.size < 2) return { n: ids.size, ready: false };
  const sum = obs.reduce((s, o) => s + o.w, 0) || 1;
  const ax = (k) => obs.reduce((s, o) => s + o[k] * o.w, 0) / sum;
  const fin = Object.entries(taste.finish).sort((a, b) => b[1] - a[1]);
  const finish = fin.length && (!fin[1] || fin[0][1] >= fin[1][1] * 1.6) ? fin[0][0] : null;
  return { n: ids.size, ready: true, warm: ax('warm'), deep: ax('deep'), vivid: ax('vivid'), finish };
}

/** 只講「明顯」的方向（|值| ≥ 0.25）；都不明顯就說還在看 */
export function tasteLines(read) {
  if (!read?.ready) return [lipLine('fact', 'adv.taste.early', {})];
  const said = [];
  if (Math.abs(read.warm) >= 0.25) said.push(read.warm > 0 ? 'adv.taste.warm' : 'adv.taste.cool');
  if (Math.abs(read.deep) >= 0.25) said.push(read.deep > 0 ? 'adv.taste.deep' : 'adv.taste.light');
  if (Math.abs(read.vivid) >= 0.25) said.push(read.vivid > 0 ? 'adv.taste.vivid' : 'adv.taste.soft');
  const out = said.length
    ? said.map((k) => lipLine('fact', k, { n: read.n }))
    : [lipLine('fact', 'adv.taste.even', { n: read.n })];
  if (read.finish) out.push(lipLine('fact', 'adv.taste.finish', { finish: 'finish.' + read.finish }));
  return out;
}

/** 依學到的喜好挑一支（可以排除現在這支）。分數＝三個方向的接近程度＋質地一致 */
export function tasteSuggest(read, products, exceptId = null) {
  if (!read?.ready) return null;
  const pool = (products || []).filter((p) => p.cat === 'lip' && p.stock > 0 && p.id !== exceptId);
  if (!pool.length) return null;
  const score = (p) => {
    const { h, C, L } = lipMetrics(p);
    const w = Math.max(-1, Math.min(1, (h - 24) / 16)), d = Math.max(-1, Math.min(1, (52 - L) / 12)),
          v = Math.max(-1, Math.min(1, (C - 42) / 14));
    // 冷暖差最明顯（看得出來的就是這個），權重比深淺與鮮豔高
    return -(1.6 * Math.abs(w - read.warm) + Math.abs(d - read.deep) + Math.abs(v - read.vivid))
           + (read.finish && p.finish === read.finish ? 0.4 : 0);
  };
  return pool.sort((a, b) => score(b) - score(a))[0];
}

/** 結束時：今天喜歡的方向＋一支最貼近的 */
export function tasteSummary(read, products) {
  if (!read?.ready) return [];
  const pick = tasteSuggest(read, products);
  return [...tasteLines(read), ...(pick ? [lipLine('tip', 'adv.taste.pick', { lip: pick.id })] : [])];
}
