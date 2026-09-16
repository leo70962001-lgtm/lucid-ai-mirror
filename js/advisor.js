import { deltaE, hexToLab } from './analysis.js';
import { faceReasonFor, chinWord, CELEBS, SHOW_CELEBS } from './faceshape.js';

/**
 * AI 顧問的說話層
 *
 * 這一層只做一件事：把已經量到的數字，翻成使用者聽得懂的句子。
 *
 * 三條規則，寫死在這裡也寫在畫面上：
 *
 *   1. **每一句話都有量到的東西撐著。** 沒有依據的稱讚不輸出 ——
 *      「你今天真美」這種話誰都會說，機器說了只會讓人懷疑其他判斷也是編的。
 *      （2026-09-14 起：推薦畫面的主要說辭改用客人聽得懂的話，數字不再塞在句子裡，
 *       而是收進「怎麼看的？」那幾個追問 —— 依據還在，隨時問得到，只是不擋在前面。）
 *   2. **不評價長相。** 講的是「量到什麼」與「可以怎麼做」，不是「好不好看」。
 *      這跟〈打分打的是契合度，不是好不好看〉是同一個立場。
 *   3. **達不到標準就不硬誇。** 條件不成立時改給可執行的建議（tip），
 *      而不是把門檻調鬆來湊一句好話。負面的事實照講，但一定附上怎麼改。
 *
 * 回傳一律是 { key, params, kind } 陣列，kind 為：
 *   praise 有依據的肯定 / fact 中性的事實 / tip 可以照做的建議 / caution 要留意的限制
 * 文案在 i18n，這裡不碰任何顯示字串。
 */

const line = (kind, key, params) => ({ kind, key, params: params || {} });

// ── 推薦畫面：講人話 ─────────────────────────────────────
// 像櫃上的彩妝師在講話：不說 ITA°、ΔE、殘差，說「白皙、偏粉、這類顏色很乾淨」。
// 也不說修飾、顯瘦、小臉 —— 臉型只用來挑「怎麼畫會把你本來的樣子襯出來」。

const SKIN_WORD = { 'very-light': 'fair', light: 'fair', intermediate: 'natural', tan: 'tan', brown: 'deep', dark: 'deep' };

/** 膚色：白皙／自然／小麥／深膚色 × 偏冷／偏暖／中間，再講哪類顏色上臉好看 */
export function plainSkin(skin) {
  if (!skin) return [];
  return [line('fact', 'adv.p.skin.' + skin.undertone, { depth: 'skinword.' + (SKIN_WORD[skin.depthKey] || 'natural') })];
}

/** 臉型：比較接近哪一種、這種臉型的特色；分不太開就照實說「介於兩者之間」 */
export function plainFace(cls) {
  if (!cls) return [];
  if (cls.unsure) return [line('caution', 'adv.p.faceUnsure', {})];
  const out = [cls.between
    ? line('fact', 'adv.p.faceBetween', { shape: 'face.' + cls.shape, second: 'face.' + cls.second })
    : line('fact', 'adv.p.face', { shape: 'face.' + cls.shape, trait: 'face.trait.' + cls.shape })];
  if (cls.estimated) out.push(line('caution', 'adv.p.faceEst', {}));
  return out;
}

// ── 化妝經驗：第一次來的人，路要鋪得比較慢 ─────────────────
// 「平常有在化妝嗎」比「你是新手嗎」好問 —— 前者是事實，後者像在評價人。
// 回答「第一次試試看」時：推薦偏清淡好上手的、濃度調低一點，每一步各給一句可以照做的小提醒。
export const LEVELS = ['often', 'some', 'new'];

export function askLevel() {
  return { lines: [line('ask', 'adv.askLevel', {})],
           opts: [opt('opt.lvlOften', 'lvlOften'), opt('opt.lvlSome', 'lvlSome'), opt('opt.lvlNew', 'lvlNew')] };
}

/** 第一次的人，清淡好上手的妝容往前排；濃妝往後 —— 但不是不給，只是不放在第一個 */
export function levelBonus(looks, level) {
  const out = {};
  if (level !== 'new' && level !== 'some') return out;
  const k = level === 'new' ? 1 : 0.5;
  for (const l of looks || []) {
    const heavy = Math.max(l.intensity.lip, l.intensity.eye, l.intensity.cheek);
    // 0.55 以下算清淡：偽素顏 0.55、男士 0.22；復古 0.92 最濃
    out[l.id] = Math.round((heavy <= 0.55 ? 14 : heavy >= 0.85 ? -16 : -4) * k);
  }
  return out;
}

/** 每一步給第一次的人一句提醒；已經常化妝的人不囉嗦 */
export function levelTip(level, where) {
  if (level !== 'new') return [];
  const key = { s2: 'adv.lvl.s2', s3: 'adv.lvl.s3', s4: 'adv.lvl.s4', s5: 'adv.lvl.s5' }[where];
  return key ? [line('tip', key, {})] : [];
}

// ── 推薦給誰：用問的，不從臉去猜 ─────────────────────────
// 從臉部判斷性別很容易錯，猜錯也很冒犯人；而且想試哪種妝本來就是個人選擇。
// 所以直接問一句「想看哪一類的妝容？」，不回答就男女都推薦。
export function askAudience() {
  return { lines: [line('ask', 'adv.askAudience', {})],
           opts: [opt('opt.audWomen', 'audWomen'), opt('opt.audMen', 'audMen'), opt('opt.audAny', 'audAny')] };
}

/**
 * AI 自動判斷後的確認：先講「已經幫你排了哪一類、這是自動判斷不一定準」，再給換的選項。
 * 不說「你是男性／女性」—— 講的是先排哪一類妝容。
 */
export function askAudienceGuess(audience) {
  const other = audience === 'men' ? 'audWomen' : 'audMen';
  return { lines: [line('ask', 'adv.askAudGuess.' + audience, {})],
           opts: [opt('opt.audKeep', 'audKeep'), opt('opt.' + other, other), opt('opt.audAny', 'audAny'),
                  opt('opt.whyAud', 'whyAud')] };
}

/** 依對象調整排序（加在膚色分數與臉型加分之上；「都可以」完全不動） */
export function audienceBonus(looks, audience) {
  const out = {};
  if (audience !== 'men' && audience !== 'women') return out;
  for (const l of looks || []) {
    const a = l.audience || 'any';
    if (audience === 'men') out[l.id] = a === 'men' ? 40 : a === 'any' ? 10 : -30;
    else out[l.id] = a === 'men' ? -40 : 0;
  }
  return out;
}

/** 男士妝容的小技巧：不講腮紅，講整理 */
export function plainGroom() { return [line('tip', 'adv.p.groom', {})]; }

/** 腮紅怎麼刷 —— 這是臉型建議裡最實用、最好照做的一句 */
export function plainBlush(cls) {
  if (!cls || cls.unsure) return [];
  return [line('tip', 'adv.p.blush', { shape: 'face.' + cls.shape, tip: 'face.blush.' + cls.shape })];
}

/**
 * 選了妝容：為什麼適合。先講臉型（這款真的襯這個臉型才講），再講顏色跟膚色合不合。
 * 不是第一名時，照實說哪一款更襯。
 */
export function plainLook(ranked, look, cls, skin) {
  if (!ranked?.length || !look || !skin) return [];
  if (!ranked.some((r) => r.look.id === look.id)) return [];
  const why = faceReasonFor(cls, look.id);
  const top = ranked[0].look.id === look.id;
  const key = look.audience === 'men' ? 'adv.p.lookMen' : why ? 'adv.p.lookFace' : 'adv.p.lookSkin';
  const out = [line(top ? 'praise' : 'fact', key,
    { look: look.id, faceWhy: why?.key || '', skinWhy: 'adv.p.skinWhy.' + skin.undertone })];
  if (!top) out.push(line('tip', 'adv.p.lookAlt', { alt: ranked[0].look.id }));
  return out;
}

/**
 * 同樣臉型的明星例子。只當「這種臉型的例子」—— 不說使用者像誰。
 * 名單怎麼挑的見 js/faceshape.js（多份清單一致才收）。
 */
export function plainCeleb(cls, audience = 'any') {
  if (!SHOW_CELEBS || !cls || cls.unsure || !CELEBS[cls.shape]) return [];
  const c = CELEBS[cls.shape];
  // 看男士妝容就舉男星、看女性妝容就舉女星；「都可以」各舉一位
  const names = audience === 'men' ? c.m : audience === 'women' ? c.f : [c.f[0], c.m[0]].filter(Boolean);
  if (!names.length) return [];            // 這種臉型沒有夠可靠的例子 —— 不硬湊
  return [line('ref', audience === 'men' ? 'adv.p.celebMen' : 'adv.p.celeb', { shape: 'face.' + cls.shape, names })];
}

/** 膚色分析完：先講量到什麼，再講這代表什麼 */
export function onSkin(skin) {
  if (!skin) return [];
  const out = [];
  const resid = Math.abs(skin.residual);
  out.push(line('fact', 'adv.depth', { ita: skin.itaDeg.toFixed(1), L: skin.lab.L.toFixed(0) }));

  if (resid >= 8) {
    // 底調明確 = 挑色號時方向清楚，這是可以查證的優點
    out.push(line('praise', 'adv.toneClear', { tone: skin.undertone, resid: resid.toFixed(1) }));
  } else if (resid < 2) {
    // 中性不是「沒特色」，是冷暖都好駕馭 —— 但要講清楚它的依據
    out.push(line('praise', 'adv.toneVersatile', { resid: resid.toFixed(1) }));
  } else {
    out.push(line('fact', 'adv.toneMild', { tone: skin.undertone, resid: resid.toFixed(1) }));
  }

  if (skin.warnings?.includes('warn.deep')) out.push(line('caution', 'adv.deepCaution'));
  if (skin.warnings?.includes('warn.sparse')) out.push(line('caution', 'adv.sparseCaution'));
  return out;
}

/** 選了妝容：這款跟膚色合到什麼程度，以及第一名是不是它 */
export function onLook(ranked, look) {
  if (!ranked?.length || !look) return [];
  const hit = ranked.find((r) => r.look.id === look.id);
  if (!hit) return [];
  const out = [];
  const why = hit.why?.[0] || null;
  if (hit.score >= 85) out.push(line('praise', 'adv.lookStrong', { n: hit.score, why }));
  else out.push(line('fact', 'adv.lookOk', { n: hit.score, why }));
  const top = ranked[0];
  if (top.look.id !== look.id && top.score - hit.score >= 5) {
    out.push(line('tip', 'adv.lookAlt', { alt: top.look.id, n: top.score }));
  }
  return out;
}

/** 配方：三件商品裡有幾件跟量到的底調一致 */
export function onPicks(picks, skin) {
  if (!picks || !skin) return [];
  const cats = ['lip', 'eye', 'cheek'].filter((c) => picks[c]);
  const same = cats.filter((c) => picks[c].tone === skin.undertone).length;
  const neutral = cats.filter((c) => picks[c].tone === 'neutral').length;
  const out = [];
  if (same === cats.length) out.push(line('praise', 'adv.picksAll', { n: cats.length }));
  else if (same + neutral === cats.length) out.push(line('fact', 'adv.picksMixed', { same, neutral }));
  else out.push(line('tip', 'adv.picksOff', { n: cats.length - same - neutral }));

  const low = cats.filter((c) => picks[c].stock > 0 && picks[c].stock <= 5);
  if (low.length) out.push(line('caution', 'adv.lowStock', { n: low.length }));
  return out;
}

/** 使用者自己換色號：換了多少、跟底調的關係怎麼變 */
export function onShadeChange(next, prev, skin) {
  if (!next || !skin) return [];
  const out = [];
  if (prev && prev.id !== next.id) {
    out.push(line('fact', 'adv.shadeGap', { de: deltaE(hexToLab(next.color), hexToLab(prev.color)).toFixed(1) }));
  }
  if (next.tone === skin.undertone) out.push(line('praise', 'adv.shadeSame', { tone: skin.undertone }));
  else if (next.tone === 'neutral') out.push(line('fact', 'adv.shadeNeutral'));
  else out.push(line('tip', 'adv.shadeOff', { tone: next.tone, mine: skin.undertone }));
  return out;
}

/** 濃度滑桿：只在兩端給建議，中間不囉嗦 */
export function onAmount(cat, value) {
  if (value >= 0.85) return [line('tip', 'adv.amountHigh', { cat, n: Math.round(value * 100) })];
  if (value > 0 && value <= 0.25) return [line('tip', 'adv.amountLow', { cat, n: Math.round(value * 100) })];
  return [];
}

/**
 * 最後給使用者的正面回饋。
 * 每一句都要有數字撐著；一句都撐不起來時，**不硬誇** —— 改成照實說 + 怎麼改。
 */
export function onFinish(v, skin) {
  if (!v) return [];
  const out = [];
  if (v.standout >= 8) out.push(line('praise', 'adv.standout', { n: v.standout.toFixed(1) }));
  if (v.fit >= 95) out.push(line('praise', 'adv.fitAll'));
  else if (v.fit >= 70) out.push(line('fact', 'adv.fitMost', { n: v.fit }));
  if (v.dh <= 18) out.push(line('praise', 'adv.harmony', { dh: v.dh.toFixed(0) }));
  if (v.match >= 85) out.push(line('praise', 'adv.matchHigh', { n: v.match }));

  if (!out.some((l) => l.kind === 'praise')) {
    // 撐不起一句好話就照實說，並且一定附上可以照做的下一步
    out.push(line('fact', 'adv.plain', { n: v.match }));
    out.push(line('tip', v.dh > 18 ? 'adv.fixHue' : v.fit < 70 ? 'adv.fixTone' : 'adv.fixLevel',
                  { dh: v.dh.toFixed(0), fit: v.fit, gain: v.gain.toFixed(1) }));
  }
  if (skin?.warnings?.includes('warn.deep')) out.push(line('caution', 'adv.deepCaution'));
  return out;
}

/**
 * 現場光線的誠實提示。
 *
 * 還原度取決於光線：眼白量得到時最準；退到臉上的高光會差一點；
 * 太暗時連相機本身都在猜。這件事不該藏起來 —— 使用者有權知道
 * 「螢幕上這個顏色，現在有多可信」。
 *
 * @param ok    眼白白平衡是否可信
 * @param hlOk  高光退路是否可用
 * @param meanY 畫面平均亮度（0–1），量不到就傳 null
 */
export function lightNote(ok, hlOk, meanY) {
  if (meanY != null && meanY < 0.18) return [line('caution', 'adv.lightDark', { n: Math.round(meanY * 100) })];
  if (ok) return [];
  if (hlOk) return [line('caution', 'adv.lightFallback')];
  return [line('caution', 'adv.lightNone')];
}

/** 進入 AR：先說清楚鏡子裡現在是什麼，再給可以做的事（shade 由呼叫端傳已翻譯的字串） */
export function onAR(pick, amount) {
  if (!pick) return [];
  return [line('fact', 'adv.arIntro', { shade: pick.shade, n: Math.round((amount ?? 0) * 100) })];
}

// ── 對話的選項 ──────────────────────────────────────────
// 只放「這台機器真的做得到」的動作。不做開放式輸入：機台離線，
// 也不該把顧客的臉或對話送上雲端 —— 做不到的事不要假裝做得到。
const opt = (key, act) => ({ key, act });

export function optsForSkin(ranked, look) {
  // 臉型那一題排最前面 —— 推薦的理由現在主要是臉型
  const o = [opt('opt.whyFace', 'whyFace'), opt('opt.whyTone', 'whyTone')];
  if (ranked?.length && look && ranked[0].look.id !== look.id) o.push(opt('opt.useTop', 'useTop'));
  // 還沒選妝容時也要有一條往前的路 —— 不然「為什麼」問完，這段對話就停在那裡了
  if (ranked?.length && !look) o.push(opt('opt.pickTop', 'useTop'));
  if (look) o.push(opt('opt.goProducts', 'goProducts'));
  return o;
}

export function optsForPicks(picks, skin, pref) {
  const o = [];
  // 記住的偏好要能「一鍵照做」，不然記了也只是嘴上說說
  const tone = prefTone(pref);
  if (tone && picks?.lip && picks.lip.tone !== tone) o.push(opt('opt.usePref', 'usePref'));
  const opposite = ['lip', 'eye', 'cheek'].some(
    (c) => picks?.[c] && picks[c].tone !== 'neutral' && picks[c].tone !== skin?.undertone);
  if (opposite) o.push(opt('opt.toNeutral', 'toNeutral'));
  o.push(opt('opt.softer', 'softer'), opt('opt.startAR', 'startAR'));
  return o;
}

export function optsForAR(zoom, mode, canRevert) {
  // 對比模式是開關，不是單向開啟 —— 標籤要說得出「再按一次會怎樣」，
  // 否則按第二次會變成狀態沒動、話也沒新的，看起來就像卡住了。
  return [opt('opt.stronger', 'stronger'), opt('opt.softer', 'softer'),
          opt('opt.nextShade', 'nextShade'),
          ...(canRevert ? [opt('opt.revert', 'revert')] : []),
          opt(mode === 'bare' ? 'opt.compareOff' : 'opt.compare', 'compare'),
          opt(mode === 'dual' ? 'opt.dualOff' : 'opt.dual', 'dual'),
          opt(zoom ? 'opt.zoomOff' : 'opt.zoom', 'zoom')];
}

export function optsForFinish() {
  return [opt('opt.whyMatch', 'whyMatch'), opt('opt.retry', 'retry')];
}

// 對話不該繞回原點：點了等於沒往前走的選項要收掉。
export const EXPLAIN_ACTS = ['whyTone', 'whyMatch', 'whyFace', 'whyCeleb', 'whyAud',
                             'whyDepth', 'whyLight', 'whyPick',      // 膚色那一題的追問
                             'whyHue', 'whyLevel', 'whyStandout'];   // 分數那一題的追問

// 回答 AI 問題用的選項 —— 一次性的，答完就收掉
export const ANSWER_ACTS = ['prefSoft', 'prefBold', 'prefKeep', 'keepBest', 'noThanks', 'keepYes', 'keepNo',
                            'audWomen', 'audMen', 'audAny', 'audKeep', 'lvlOften', 'lvlSome', 'lvlNew',
                            'ctxMood', 'ctxWeather', 'ctxPlan', 'ctxSkip'];
export const dropAnswers = (opts) => (opts || []).filter((o) => !ANSWER_ACTS.includes(o.act));

/** 問過的「為什麼」就不再出現 —— 同一題問第二次不會有新資訊 */
export function dropAsked(opts, asked) {
  const set = asked instanceof Set ? asked : new Set(asked || []);
  return (opts || []).filter((o) => !(EXPLAIN_ACTS.includes(o.act) && set.has(o.act)));
}

// 對話調整濃度的上下限。下限 0.15 是因為再低就等於沒上妝 ——
// 這個值必須跟 app.js 的夾限一致，否則會出現「點了沒反應但選項還在」的鬼打牆。
export const AMOUNT_MIN = 0.15, AMOUNT_MAX = 1;

/** 濃度已經到頂／到底時，對應的選項收掉，不給點了沒反應的東西 */
export function dropDeadAmount(opts, amount) {
  const v = Object.values(amount || {});
  const atMax = v.length > 0 && v.every((x) => x >= AMOUNT_MAX - 0.001);
  const atMin = v.length > 0 && v.every((x) => x <= AMOUNT_MIN + 0.001);
  return (opts || []).filter((o) => !(o.act === 'stronger' && atMax) && !(o.act === 'softer' && atMin));
}

/**
 * 解釋完還能追問什麼。
 *
 * 「為什麼這樣判斷」講完就只剩一個選項，對話等於被解釋卡住 ——
 * 一個肯回答的顧問，被追問第二次還答得出來才算數。這些追問一樣只攤開量到的數字。
 */
export function optsAfterWhy(where) {
  if (where === 'face') return [opt('opt.whyCeleb', 'whyCeleb')];
  if (where === 's2') {
    return [opt('opt.whyDepth', 'whyDepth'), opt('opt.whyLight', 'whyLight'), opt('opt.whyPick', 'whyPick')];
  }
  return [opt('opt.whyHue', 'whyHue'), opt('opt.whyLevel', 'whyLevel'), opt('opt.whyStandout', 'whyStandout')];
}

/** 「為什麼？」—— 把算式攤開講，不是換句話再說一次結論 */
export function explain(topic, d) {
  if (topic === 'tone' && d) {
    return [line('fact', 'adv.whyTone',
      { L: d.lab.L.toFixed(0), hue: d.hue.toFixed(0), base: (0.249 * d.lab.L + 47).toFixed(0), resid: d.residual.toFixed(1) })];
  }
  if (topic === 'match' && d) {
    return [line('fact', 'adv.whyMatch', { fit: d.fit, dh: d.dh.toFixed(0), gain: d.gain.toFixed(1), n: d.match })];
  }
  // ── 臉型：量了哪幾個地方、跟典型比例差多少 ──
  if (topic === 'face' && d?.f && d?.cls && !d.cls.unsure) {
    const out = [line('fact', 'adv.whyFace', {
      R: d.f.R.toFixed(2), fr: Math.round(d.f.fr * 100), jr: Math.round(d.f.jr * 100),
      chin: 'face.chin.' + chinWord(d.f.taper), shape: 'face.' + d.cls.shape, range: 'face.range.' + d.cls.shape })];
    if (d.f.estimated) out.push(line('caution', 'adv.p.faceEst', {}));
    return out;
  }
  if (topic === 'celeb') return [line('fact', 'adv.whyCeleb', { n: 62, total: 117 })];
  // ── 追問：膚色那一邊 ──
  if (topic === 'depth' && d?.band) {
    return [line('fact', 'adv.whyDepth',
      { ita: d.itaDeg.toFixed(1), min: d.band.min, depth: 'depth.' + d.depthKey })];
  }
  if (topic === 'light' && d) {
    // 眼白量得到才敢說「換算回 D65 之後才判定」；量不到就照實說判定會比較不穩
    return d.reliable
      ? [line('fact', 'adv.whyLight', { n: d.samples, cct: Math.round(d.cct) })]
      : [line('caution', 'adv.whyLightNo', { n: d.samples || 0 })];
  }
  if (topic === 'pick' && d) {
    return [line('fact', 'adv.whyPick', { total: d.total, n: d.n, tone: d.tone })];
  }
  // ── 追問：分數那一邊 ──
  if (topic === 'hue' && d) {
    return [line('fact', 'adv.whyHue', { dh: d.dh.toFixed(0), n: d.harmony })];
  }
  if (topic === 'level' && d) {
    return [line('fact', 'adv.whyLevel',
      { gain: d.gain.toFixed(1), want: d.want.toFixed(1), diff: Math.abs(d.gain - d.want).toFixed(1), n: d.done })];
  }
  if (topic === 'standout' && d) {
    return [line('fact', 'adv.whyStandout', { n: d.standout.toFixed(1), band: d.band.id + '.say' })];
  }
  return [];
}

export const ACTS = ['whyTone', 'whyDepth', 'whyLight', 'whyPick', 'whyFace', 'whyCeleb',
                     'whyHue', 'whyLevel', 'whyStandout',
                     'useTop', 'goProducts', 'toNeutral', 'softer', 'startAR',
                     'stronger', 'nextShade', 'compare', 'dual', 'zoom', 'whyMatch', 'retry',
                     'prefSoft', 'prefBold', 'prefKeep', 'keepBest', 'noThanks', 'revert', 'usePref',
                     'keepYes', 'keepNo', 'audWomen', 'audMen', 'audAny', 'audKeep', 'whyAud',
                     'lvlOften', 'lvlSome', 'lvlNew',
                     'ctxMood', 'ctxWeather', 'ctxPlan', 'ctxSkip'];

// ── 反過來問：AI 也會提問 ───────────────────────────────
// 只問「答案會真的改變接下來做什麼」的問題。問完沒有後續的問題不要問 ——
// 那只是把對話拉長，不是互動。問題一樣掛著一個量到的數字。

/**
 * 情境三題：心情、天氣、行程。
 *
 * 這三題是**唯一沒有數字撐著的句子** —— 因為它們量不到，只能問。
 * 所以答案一律標成「你說的」而不是「量測」：兩種證據的可信度差很多，
 * 混在一起講，量出來的那些也會跟著不可信（同 js/context.js 開頭的立場）。
 *
 * @param kind  'mood' | 'weather' | 'plan'
 * @param items [{ id, key }] 這一題的選項（文案鍵由呼叫端給，這裡不碰顯示字串）
 * @param guess 機器已經猜到的答案（表情猜心情、氣象來源給天氣）—— 有猜到就改成「確認」
 */
export function askContext(kind, items, guess) {
  const act = 'ctx' + kind[0].toUpperCase() + kind.slice(1);
  const g = guess && items.find((it) => it.id === guess);
  const opts = g ? [{ key: 'opt.ctxYes', act, val: g.id }] : [];
  for (const it of items) { if (!g || it.id !== g.id) opts.push({ key: it.key, act, val: it.id }); }
  opts.push({ key: 'opt.ctxSkip', act: 'ctxSkip', val: kind });
  return { lines: [line('ask', g ? 'adv.ask' + kind + 'Guess' : 'adv.ask' + kind,
                        g ? { guess: g.key } : {})], opts };
}

/** 答完一題：把「因為你這樣說，所以怎麼調」講出來，沒選就照實說沒選 */
export function onContext(kind, choiceKey, whyKey) {
  if (!choiceKey) return [line('told', 'adv.ctxSkipped', {})];
  return [line('told', 'adv.ctxGot', { choice: choiceKey, why: whyKey || '' })];
}

/** 進配方畫面時問的那一題：今天想低調還是明顯 */
export function askAmount(amount) {
  return { lines: [line('ask', 'adv.askAmount', { n: Math.round((amount ?? 0) * 100) })],
           opts: [opt('opt.prefSoft', 'prefSoft'), opt('opt.prefBold', 'prefBold'),
                  opt('opt.prefKeep', 'prefKeep')] };
}

// ── 偏好：從行為推，不是從問卷猜 ─────────────────────────
// 只認兩種證據：使用者自己按了「再淡／更明顯」，以及在某支色號上**真的停了下來**。
// 6 秒是分界 —— 比這短的多半只是滑過去，算進偏好就是在編故事。
export const DWELL_MS = 6000;

export function newPref() { return { soft: 0, bold: 0, kept: [] }; }

export function notePref(pref, what) {
  if (pref && (what === 'soft' || what === 'bold')) pref[what]++;
  return pref;
}

/** 在某支色號上停留夠久 → 記下它的底調 */
export function noteDwell(pref, product, ms) {
  if (!pref || !product || !(ms >= DWELL_MS)) return pref;
  if (!pref.kept.some((k) => k.id === product.id)) {
    pref.kept.push({ id: product.id, tone: product.tone, ms: Math.round(ms) });
  }
  return pref;
}

/** 停留過的色號裡佔多數的底調 —— 至少兩支，而且要明顯多於其他，不然不算數 */
export function prefTone(pref) {
  const n = {};
  for (const k of pref?.kept || []) n[k.tone] = (n[k.tone] || 0) + 1;
  const rank = Object.entries(n).sort((a, b) => b[1] - a[1]);
  if (!rank.length || rank[0][1] < 2) return null;
  if (rank[1] && rank[1][1] >= rank[0][1]) return null;
  return rank[0][0];
}

/** 濃度的偏好：差兩次以上才算 —— 一來一回不代表什麼 */
export function prefBias(pref) {
  if (!pref) return null;
  if (pref.soft >= pref.bold + 2) return 'soft';
  if (pref.bold >= pref.soft + 2) return 'bold';
  return null;
}

/** 換色號時優先給「停留過的那個底調」，沒有偏好就照原本的順序輪 */
export function pickNext(list, curId, pref) {
  if (!list?.length) return null;
  const i = list.findIndex((p) => p.id === curId);
  const order = i < 0 ? [...list] : [...list.slice(i + 1), ...list.slice(0, i)];
  if (!order.length) return null;
  const tone = prefTone(pref);
  if (tone) { const same = order.find((p) => p.tone === tone); if (same) return same; }
  return order[0];
}

/** 依偏好挑的時候，把依據講出來 —— 不講的話就變成「它自己亂換」 */
export function prefNote(pref, product) {
  const tone = prefTone(pref);
  if (!tone || !product || product.tone !== tone) return [];
  return [line('fact', 'adv.prefTone',
    { n: pref.kept.filter((k) => k.tone === tone).length, tone, sec: Math.round(DWELL_MS / 1000) })];
}

/**
 * 回到配方畫面時，把記住的偏好講出來 —— 記了不講，使用者無從知道它記了什麼。
 * 但唇色本來就已經是那個底調時要閉嘴：問一句沒有答案的問題比不問更怪。
 */
export function prefRecall(pref, picks) {
  const tone = prefTone(pref);
  if (!tone || !picks?.lip || picks.lip.tone === tone) return [];
  return [line('fact', 'adv.prefRecall',
    { n: pref.kept.filter((k) => k.tone === tone).length, tone, sec: Math.round(DWELL_MS / 1000) })];
}

// ── 點頭 / 搖頭 ─────────────────────────────────────────
// 在鏡子前面，「點頭」比找一顆按鈕自然。但誤判的代價是幫使用者做了他沒要的決定，
// 所以只在**有是非題等著回答的時候**才啟用，而且按鈕一直都在 —— 手勢是多一條路，不是取代。
export const GESTURE_MS = 1400;      // 只看最近這段時間
export const GESTURE_AMP = 0.055;    // 幅度門檻（以臉寬為單位）

/**
 * 從鼻尖的軌跡判斷點頭或搖頭。
 * buf = [{ t, x, y }]，x/y 已經換算成「相對臉中心、以臉寬為單位」——
 * 這樣人靠近或走遠都用同一組門檻。
 *
 * 判定要同時滿足三件事：幅度夠、方向來回至少兩次、而且另一軸明顯比較小。
 * 只看幅度會把「低頭看商品」當成點頭；只看次數會把輕微晃動當成搖頭。
 */
export function readGesture(buf, now) {
  const pts = (buf || []).filter((p) => now - p.t <= GESTURE_MS);
  if (pts.length < 8) return null;
  const amp = (k) => { const v = pts.map((p) => p[k]); return Math.max(...v) - Math.min(...v); };
  const turns = (k) => {
    let n = 0, dir = 0;
    for (let i = 1; i < pts.length; i++) {
      const dv = pts[i][k] - pts[i - 1][k];
      if (Math.abs(dv) < 0.004) continue;      // 忽略抖動
      const s = Math.sign(dv);
      if (dir && s !== dir) n++;
      dir = s;
    }
    return n;
  };
  const ay = amp('y'), ax = amp('x');
  if (ay >= GESTURE_AMP && ay > ax * 1.6 && turns('y') >= 2) return 'nod';
  if (ax >= GESTURE_AMP && ax > ay * 1.6 && turns('x') >= 2) return 'shake';
  return null;
}

// ── 直接點鏡子裡的臉 ────────────────────────────────────
// 鏡子本身就是介面：想問哪裡就點哪裡，不用先在下面的清單裡找到對應的那一列。

/**
 * 點下去的位置屬於哪個部位。
 * anchors 由呼叫端從關鍵點算好（[{ kind, x, y, r }]，單位都是畫布像素），
 * 這裡只做「最近而且在範圍內」的判定 —— 純幾何，好測。
 */
export function nearestRegion(pt, anchors) {
  let best = null, bd = Infinity;
  for (const a of anchors || []) {
    const dist = Math.hypot(pt.x - a.x, pt.y - a.y);
    if (dist <= a.r && dist < bd) { bd = dist; best = a.kind; }
  }
  return best;
}

/** 點了某個部位：講那個部位量到什麼。跟其他句子一樣，一句一個數字。 */
export function onRegion(kind, d) {
  if (!d) return [];
  if (kind === 'lip') {
    return [line('fact', 'adv.regLip', { shade: d.shade, n: Math.round(d.amount * 100), de: d.de.toFixed(1) })];
  }
  if (kind === 'eye' || kind === 'cheek') {
    return [line('fact', 'adv.reg' + (kind === 'eye' ? 'Eye' : 'Cheek'),
                 { name: d.shade, n: Math.round(d.amount * 100), tone: d.tone })];
  }
  if (kind === 'skin') {
    return [line('fact', 'adv.regSkin',
                 { ita: d.itaDeg.toFixed(1), L: d.lab.L.toFixed(0), tone: d.undertone, n: d.patches })];
  }
  return [];
}

/**
 * AI 主動開口的規則 —— 不等使用者點。
 *
 * 但也不能變成一直插話：每一種情況一場只講一次（講過的 id 由呼叫端記著），
 * 第一個成立的就回傳，不會一次倒三句。跟其他句子一樣，每一句都掛著數字。
 */
export function observe(o) {
  if (!o) return null;
  const said = o.said instanceof Set ? o.said : new Set(o.said || []);
  if (o.lipPct != null && o.lipPct < 9 && !said.has('tooFar')) {
    return { id: 'tooFar', lines: [line('tip', 'adv.tooFar', { n: o.lipPct.toFixed(1) })] };
  }
  if (o.idleMs >= 12000 && o.tried >= 3 && o.best && !said.has('askBest')) {
    return { id: 'askBest', yesNo: true,
             lines: [line('ask', 'adv.askBest', { n: o.tried, shade: o.best.shade, de: o.best.de.toFixed(1) })],
             opts: [opt('opt.keepBest', 'keepBest'), opt('opt.noThanks', 'noThanks')] };
  }
  if (o.dwellMs >= 10000 && o.idleMs >= 10000 && o.curShade && !said.has('askKeep:' + o.curId)) {
    return { id: 'askKeep:' + o.curId, yesNo: true,
             lines: [line('ask', 'adv.askKeep', { shade: o.curShade, sec: Math.round(o.dwellMs / 1000) })],
             opts: [opt('opt.keepYes', 'keepYes'), opt('opt.keepNo', 'keepNo')] };
  }
  if (o.idleMs >= 20000 && o.curDe != null && !said.has('idleTry')) {
    return { id: 'idleTry', lines: [line('tip', 'adv.idleTry', { de: o.curDe.toFixed(1) })] };
  }
  return null;
}

/** 收尾：把這一場裡使用者真的做過的事，用數字講回去（不是換句話再誇一次） */
export function sessionSummary(s) {
  if (!s) return [];
  const out = [];
  if (s.tried >= 2) out.push(line('fact', 'adv.sumTried', { n: s.tried, shade: s.shade }));
  const a = Math.round((s.amount0 ?? 0) * 100), b = Math.round((s.amount1 ?? 0) * 100);
  if (Math.abs(a - b) >= 5) out.push(line('fact', 'adv.sumAmount', { a, b }));
  const tone = prefTone(s.pref);
  if (tone) {
    out.push(line('fact', 'adv.sumTone',
      { n: s.pref.kept.filter((k) => k.tone === tone).length, tone, sec: Math.round(DWELL_MS / 1000) }));
  }
  return out;
}

/** 畫面上要標「這句話的依據是什麼」用的 */
// told = 使用者自己說的（心情／天氣／行程）。跟「量測」分開標，是因為
// 兩種證據的可信度不一樣 —— 混成同一種語氣，量出來的那些也會跟著貶值。
// ref = 參考例子（明星臉型）—— 不是量測、不是建議，只是「這種臉型的人通常這樣畫」的例子
export const KINDS = ['praise', 'fact', 'tip', 'caution', 'ask', 'told', 'ref'];
