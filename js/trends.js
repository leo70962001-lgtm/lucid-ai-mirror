/**
 * 流行妝容：一份「有日期、可更新」的資料包
 *
 * 機台是離線的，不會自己上網抓流行 —— 流行是人整理好、寫進這份資料包的。
 * 所以每一筆都帶著出處與整理日期，畫面上也照實顯示「流行資料：YYYY-MM 更新」；
 * 超過半年沒更新就自己標成過期，不要假裝自己很懂現在。
 *
 * 每一筆流行都要能「在這台機器上真的做得到」：對應到店裡有的商品、濃度，
 * 或是進入自己上妝模式照著畫。做不到的流行不放進來 —— 講了卻不能試，只是廣告。
 *
 * 2026 年這一版的來源：
 *   Who What Wear「5 Makeup Artist–Backed Lip Trends Defining Spring 2026」(2026-04)
 *     https://www.whowhatwear.com/beauty/makeup/spring-lip-trends-2026
 *   Who What Wear「Spring 2026 Makeup Trends」https://www.whowhatwear.com/beauty/makeup/spring-2026-makeup-trends
 *   Coveteur「Fall 2026 Makeup Trends」https://coveteur.com/fall-2026-makeup-trends
 *   美的「2026春メイク」https://www.biteki.com/make-up/make-up-face-catalog/360083
 *   資生堂「2026年春夏トレンドメイク：重心高めチーク」https://www.shiseido.co.jp/sw/beautyinfo/archive/BJ010497.html
 */

import { lipMetrics } from './lipcolor.js';

/** 這份資料包整理的日期，以及顯示用的版本字串 */
export const TREND_PACK = '2026-09';
export const TREND_STALE_DAYS = 200;      // 超過大約半年就標成可能過期

export function trendAgeDays(pack = TREND_PACK, now = Date.now()) {
  const [y, m] = pack.split('-').map(Number);
  return Math.round((now - Date.UTC(y, m - 1, 1)) / 86400000);
}
export const trendStale = (pack = TREND_PACK, now = Date.now()) => trendAgeDays(pack, now) > TREND_STALE_DAYS;

/**
 * 一筆流行：
 *   cats    影響哪些部位（拿來挑商品）
 *   want    想要的顏色方向（−1…1：暖冷、深淺、鮮豔），用來從店裡挑最接近的
 *   finish  想要的質地（挑商品時加分）
 *   seasons 這個流行特別襯哪幾季（空＝都可以）；不是「其他季不能做」，只是排序往前
 *   paint   需要自己畫的位置（腮紅的畫法類），對應自己上妝模式
 *   men     男士妝容時要不要推
 *   src     出處（顯示在句子後面）
 */
export const TRENDS = [
  { id: 'blurLip',  cats: ['lip'], want: { warm: 0, deep: 0.1, vivid: -0.3 }, finish: 'matte',
    seasons: [], men: true, amount: 0.5, src: 'www2026lip' },
  { id: 'mauveLip', cats: ['lip'], want: { warm: -0.4, deep: 0.2, vivid: -0.3 }, finish: 'matte',
    seasons: ['summer', 'winter'], men: false, src: 'www2026lip' },
  { id: 'glazeLip', cats: ['lip'], want: { warm: -0.1, deep: -0.3, vivid: 0.5 }, finish: 'gloss',
    seasons: ['spring', 'winter'], men: false, amount: 0.62, src: 'www2026lip' },
  { id: 'monoBronze', cats: ['lip', 'cheek', 'eye'], want: { warm: 0.7, deep: 0.3, vivid: 0.1 }, finish: null,
    seasons: ['autumn', 'spring'], men: true, src: 'www2026lip' },
  { id: 'monoPink', cats: ['lip', 'cheek', 'eye'], want: { warm: -0.2, deep: -0.2, vivid: -0.2 }, finish: null,
    seasons: ['summer', 'spring'], men: false, src: 'biteki2026' },
  { id: 'highBlush', cats: ['cheek'], want: { warm: -0.1, deep: 0, vivid: 0.1 }, finish: null,
    seasons: [], men: false, paint: 'cheek', src: 'shiseido2026' },
  { id: 'cBlush', cats: ['cheek'], want: { warm: 0.1, deep: 0.1, vivid: 0.2 }, finish: null,
    seasons: [], men: false, paint: 'cheek', src: 'www2026spring' },
  { id: 'sunBlush', cats: ['cheek'], want: { warm: 0.4, deep: 0, vivid: 0.3 }, finish: null,
    seasons: ['spring', 'autumn'], men: true, paint: 'cheek', src: 'www2026spring' },
  { id: 'berryMono', cats: ['lip', 'cheek'], want: { warm: -0.5, deep: 0.6, vivid: 0.3 }, finish: null,
    seasons: ['winter', 'autumn'], men: false, src: 'coveteur2026' },
];

const trendLine = (kind, key, params) => ({ kind, key, params: params || {} });

/** 商品在三個方向上的位置（跟喜好學習用同一把尺，才能互相比較） */
function axes(p) {
  const { h, C, L } = lipMetrics(p);   // 對眼影、腮紅一樣適用：只是取色值
  return { warm: Math.max(-1, Math.min(1, (h - 24) / 16)),
           deep: Math.max(-1, Math.min(1, (52 - L) / 12)),
           vivid: Math.max(-1, Math.min(1, (C - 42) / 14)) };
}

/** 從店裡挑最貼近這個流行的一件（該品項、有貨） */
export function trendPick(item, products, cat) {
  let pool = (products || []).filter((p) => p.cat === cat && p.stock > 0);
  if (!pool.length) return null;
  // 指定質地的流行（光澤感、霧感）先只看那個質地 —— 質地就是這個流行本身，不是加分項
  const sameFinish = item.finish ? pool.filter((p) => p.finish === item.finish) : [];
  if (sameFinish.length) pool = sameFinish;
  const score = (p) => {
    const a = axes(p), w = item.want || {};
    return -(1.4 * Math.abs(a.warm - (w.warm ?? 0)) + Math.abs(a.deep - (w.deep ?? 0)) + Math.abs(a.vivid - (w.vivid ?? 0)))
           + (item.finish && p.finish === item.finish ? 0.5 : 0);   // 同質地的還是再加一點（沒得篩時用）
  };
  return pool.sort((a, b) => score(b) - score(a))[0];
}

/** 這個流行在這台機器上具體要做什麼：換哪幾件、濃度、要不要自己畫 */
export function trendPlan(item, products) {
  if (!item) return null;
  const plan = { id: item.id, paint: item.paint || null, amount: item.amount ?? null };
  for (const cat of item.cats) { const p = trendPick(item, products, cat); if (p) plan[cat] = p; }
  return plan;
}

/**
 * 排序：襯這一季的排前面，再來是跟今天看下來的喜好接近的。
 * 已經講過的往後排 —— 同一個流行講第二次沒有意義。
 */
export function trendsFor({ season = null, audience = 'any', taste = null, said = new Set() } = {}) {
  const fit = (it) => {
    let s = 0;
    if (season && it.seasons.length) s += it.seasons.includes(season) ? 2 : -0.5;
    if (taste?.ready) {
      s += 1 - (Math.abs((it.want.warm ?? 0) - taste.warm) + Math.abs((it.want.deep ?? 0) - taste.deep)) / 2;
    }
    if (said.has(it.id)) s -= 10;
    return s;
  };
  return TRENDS.filter((it) => (audience === 'men' ? it.men : true)).sort((a, b) => fit(b) - fit(a));
}

/** 講一個流行：名稱＋為什麼在流行＋兩句怎麼做（＋出處與資料日期） */
export function trendLines(item, plan = null) {
  if (!item) return [trendLine('fact', 'adv.trend.none', {})];
  const out = [trendLine('fact', 'adv.trend.is', { name: 'trend.' + item.id, why: 'trend.' + item.id + '.why' }),
               trendLine('tip', 'trend.' + item.id + '.how1', {}),
               trendLine('tip', 'trend.' + item.id + '.how2', {})];
  if (plan?.lip || plan?.cheek) {
    const which = plan.lip && plan.cheek ? 'both' : plan.lip ? 'lip' : 'cheek';
    out.push(trendLine('tip', 'adv.trend.here.' + which, { lip: plan.lip?.id, cheek: plan.cheek?.id }));
  }
  out.push(trendLine('ref', 'adv.trend.src', { src: 'trend.src.' + item.src, pack: TREND_PACK }));
  return out;
}

/** 過期提醒：資料包太舊就照實說一句 */
export const trendStaleLines = (pack = TREND_PACK, now = Date.now()) =>
  (trendStale(pack, now) ? [trendLine('caution', 'adv.trend.stale', { pack })] : []);
