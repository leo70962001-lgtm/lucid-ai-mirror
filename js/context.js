/**
 * 情境推薦：心情、天氣、行程
 *
 * 這一層跟膚色分析**刻意分開**。
 *
 * 膚色契合是量出來的（CIELAB / ITA° / 底調殘差），情境是使用者自己說的 ——
 * 兩種證據的可信度差很多，所以分開加權、理由也分開標示：畫面上量測來的理由標
 * 「量測」，情境來的標「你告訴我們的」。不把情境混進膚色分數裡，是為了不讓
 * 「今天心情不好」去改變「這支色號配不配你的膚色」。
 *
 * 規則全部寫死在這個檔案裡，每一條都附理由 key，不做黑箱推薦。
 * 這些規則是化妝的一般常識（悶熱容易脫妝、乾冷唇容易裂、面試要低調），
 * **不是量測結果**，畫面與 README 都照實說。
 */

export const MOODS = ['bright', 'calm', 'tired', 'nervous'];
export const WEATHERS = ['hot', 'humid', 'mild', 'cold'];
export const PLANS = ['work', 'meeting', 'date', 'party', 'errand'];

/**
 * finish：這個情境偏好的質地（會覆蓋妝容原本的偏好，再交給 resolveLook 重新挑商品）
 * amount：濃度倍率（乘在妝容本來的濃度上）
 * look  ：妝容加權分（加在膚色契合分上，不取代它）
 * tone  ：色調偏好，只在膚色分數相同時當同分的決勝
 */
const RULES = {
  weather: {
    hot:   { finish: { lip: 'matte', cheek: 'matte' }, amount: { lip: 0.92, eye: 0.90, cheek: 0.95 }, reason: 'ctx.why.hot' },
    humid: { finish: { lip: 'matte', eye: 'matte' },   amount: { eye: 0.85 },                        reason: 'ctx.why.humid' },
    mild:  {                                                                                          reason: 'ctx.why.mild' },
    cold:  { finish: { lip: 'gloss' },                 amount: { cheek: 1.10 },                      reason: 'ctx.why.cold' },
  },
  plan: {
    work:    { look: { clean: 8, natural: 6 },  amount: { lip: 0.90, eye: 0.90, cheek: 0.95 }, reason: 'ctx.why.work' },
    meeting: { look: { clean: 10, natural: 6 }, finish: { lip: 'matte' }, amount: { eye: 0.85 }, reason: 'ctx.why.meeting' },
    date:    { look: { kbeauty: 10, natural: 4 }, finish: { lip: 'gloss' }, amount: { cheek: 1.10 }, reason: 'ctx.why.date' },
    party:   { look: { retro: 10, kbeauty: 6 }, amount: { lip: 1.10, eye: 1.15 },              reason: 'ctx.why.party' },
    errand:  { look: { natural: 8 },            amount: { lip: 0.85, eye: 0.80, cheek: 0.90 }, reason: 'ctx.why.errand' },
  },
  mood: {
    bright:  { look: { kbeauty: 6, retro: 4 },  amount: { lip: 1.05 },                 reason: 'ctx.why.bright' },
    calm:    { look: { clean: 6, natural: 4 },                                          reason: 'ctx.why.calm' },
    // 疲憊時加強腮紅是化妝常識（血色感來自頰部），不是量測結論
    tired:   { look: { kbeauty: 4, clean: 4 },  amount: { cheek: 1.30, lip: 1.05 }, tone: 'warm', reason: 'ctx.why.tired' },
    nervous: { look: { natural: 8, clean: 6 },  amount: { eye: 0.85 },                  reason: 'ctx.why.nervous' },
  },
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * 目前選到的情境會怎麼調整推薦。
 * ctx 的每一項都可以是 null —— 沒選就完全不影響（any === false）。
 */
export function contextAdvice(ctx = {}) {
  const finish = {}, amount = { lip: 1, eye: 1, cheek: 1 }, look = {}, reasons = [];
  let tone = null;
  for (const kind of ['mood', 'weather', 'plan']) {
    const id = ctx[kind];
    const rule = id && RULES[kind] && RULES[kind][id];
    if (!rule) continue;
    Object.assign(finish, rule.finish || {});
    for (const [k, v] of Object.entries(rule.amount || {})) amount[k] *= v;
    for (const [k, v] of Object.entries(rule.look || {})) look[k] = (look[k] || 0) + v;
    if (rule.tone) tone = rule.tone;
    reasons.push({ kind, id, key: rule.reason });
  }
  return { finish, amount, look, tone, reasons, any: reasons.length > 0 };
}

/** 依情境調整後的濃度。上限 1（滑桿的極值），也不會把任何一項調到 0 以下 */
export function adjustIntensity(base, amount) {
  const out = {};
  for (const k of ['lip', 'eye', 'cheek']) out[k] = +clamp01((base[k] ?? 0) * (amount[k] ?? 1)).toFixed(3);
  return out;
}

/**
 * 情境加權後的妝容排序。
 * 膚色契合分 score 原封不動，情境只是加上去 —— 量測與情境誰貢獻多少，一眼看得出來。
 */
export function rankWithContext(ranked, advice) {
  return ranked
    .map((r) => ({ ...r, ctxBonus: advice.look[r.look.id] || 0, total: r.score + (advice.look[r.look.id] || 0) }))
    .sort((a, b) => b.total - a.total);
}

/**
 * 表情 → 心情的**猜測**。bs 是 MediaPipe 的 52 個表情係數（0–1）。
 *
 * 表情不等於心情 —— 沒在笑不代表心情不好，這只是給一個預設值，
 * 使用者可以直接改掉。畫面上也照實標成「自動判讀，可以改」。
 */
export function moodFromFace(bs) {
  if (!bs) return null;
  const v = (n) => bs[n] || 0;
  const smile = Math.max(v('mouthSmileLeft'), v('mouthSmileRight'));
  const frown = Math.max(v('mouthFrownLeft'), v('mouthFrownRight'));
  const worry = v('browInnerUp');
  const heavy = Math.max(v('eyeBlinkLeft'), v('eyeBlinkRight'));
  const squint = Math.max(v('eyeSquintLeft'), v('eyeSquintRight'));
  if (smile > 0.35) return 'bright';
  if (worry > 0.40 || frown > 0.25) return 'nervous';
  if (heavy > 0.45 || (squint > 0.45 && smile < 0.15)) return 'tired';
  return 'calm';
}

/**
 * 外部天氣資料的掛勾。機台端可以自己餵當地天氣（例如櫃位系統定時寫入），
 * App 本身仍然不發任何對外請求 —— 離線保證不能為了這個功能破掉。
 *   globalThis.__LUCID_WEATHER__ = 'hot' | 'humid' | 'mild' | 'cold'
 *   或網址參數 ?weather=hot
 */
export function externalWeather(search = '') {
  const fromGlobal = typeof globalThis !== 'undefined' ? globalThis.__LUCID_WEATHER__ : null;
  const fromUrl = new URLSearchParams(search).get('weather');
  const v = fromGlobal || fromUrl;
  return WEATHERS.includes(v) ? v : null;
}
