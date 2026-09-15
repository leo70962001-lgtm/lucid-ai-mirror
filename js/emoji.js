/**
 * 對話裡的表情符號
 *
 * 表情符號只在「顯示」時加在句子與按鈕前面，不寫進三種語言的文案 ——
 * 文案保持乾淨，換語言不用重配，也不會有某個語言漏加的問題。
 *
 * 選符號的原則：輕鬆、像朋友傳訊息，但不評價長相（不用 😍、🔥辣、👑 美這類在說「你很好看」的用法），
 * 也不嚇人（「留意」類的句子用 🙏，不用 ⚠️）。
 */

// 句子：依文案鍵比對，先比對到的先用（越具體的放越前面）
const LINE = [
  [/^adv\.hi\./, '👋'],
  [/^adv\.p\.face(Est|Unsure)$/, '🙏'],
  [/^adv\.p\.face/, '✨'],
  [/^adv\.p\.skin\./, '🌸'],
  [/^adv\.p\.blush$/, '🍑'],
  [/^adv\.p\.look(Face|Skin)$/, '💄'],
  [/^adv\.p\.(lookMen|groom)$/, '🧴'],
  [/^adv\.audGot\./, '👌'],
  [/^adv\.whyAud$/, '🤖'],
  [/^adv\.p\.lookAlt$/, '👉'],
  [/^adv\.p\.celeb/, '🌟'],
  [/^adv\.whyFace$/, '📏'],
  [/^adv\.whyCeleb$/, '📚'],
  [/^adv\.why(Tone|Depth|Hue)$/, '🎨'],
  [/^adv\.whyLight(No)?$/, '💡'],
  [/^adv\.whyPick$/, '🛍️'],
  [/^adv\.why(Level|Match)$/, '🧮'],
  [/^adv\.whyStandout$/, '👀'],
  [/^adv\.askmood/, '😊'],
  [/^adv\.askweather/, '🌤️'],
  [/^adv\.askplan$/, '📅'],
  [/^adv\.ask/, '💬'],
  [/^adv\.ctxGot$/, '📝'],
  [/^adv\.ctxSkipped$/, '👌'],
  [/^adv\.pref(Soft|Bold|Keep)$/, '👌'],
  [/^adv\.(prefTone|prefRecall)$/, '💡'],
  [/^adv\.(didPref|didBest|keptYes|shadeSame)$/, '💖'],
  [/^adv\.arIntro$/, '🪞'],
  [/^adv\.didSofter$/, '🌿'],
  [/^adv\.didStronger$/, '💥'],
  [/^adv\.(atMin|atMax|gotNod)$/, '🙆'],
  [/^adv\.gotShake$/, '🙅'],
  [/^adv\.shadeGap$/, '🎨'],
  [/^adv\.(shadeNeutral|didNeutral)$/, '🤍'],
  [/^adv\.shadeOff$/, '😉'],
  [/^adv\.didCompare/, '👀'],
  [/^adv\.didDual/, '⚖️'],
  [/^adv\.didZoom/, '🔍'],
  [/^adv\.didRevert$/, '↩️'],
  [/^adv\.keepCur$/, '👌'],
  [/^adv\.(tooFar)$/, '📱'],
  [/^adv\.(idleTry|amountHigh|amountLow|fix\w+)$/, '💡'],
  [/^adv\.light/, '💡'],
  [/^adv\.reg/, '👆'],
  [/^adv\.sum/, '🎉'],
  [/^adv\.(standout|fitAll|harmony|matchHigh)$/, '🎉'],
  [/^adv\.fitMost$/, '👍'],
  [/^adv\.plain$/, '💭'],
  [/^adv\.picks/, '🛍️'],
  [/^adv\.lowStock$/, '⏳'],
  [/^adv\.noCam$/, '📷'],
  [/^adv\.(deep|sparse)Caution$/, '🙏'],
];
const KIND = { praise: '✨', fact: '💬', tip: '💡', caution: '🙏', ask: '💬', told: '📝', ref: '🌟' };

export function lineEmoji(l) {
  if (!l) return '';
  for (const [re, e] of LINE) if (re.test(l.key)) return e;
  return KIND[l.kind] || '💬';
}

// 快速回覆按鈕：依動作（情境題依選項值）
const ACT = {
  whyFace: '📏', whyTone: '🎨', whyDepth: '🎨', whyLight: '💡', whyPick: '🛍️', whyCeleb: '🌟',
  whyMatch: '🧮', whyHue: '🎨', whyLevel: '📐', whyStandout: '👀',
  useTop: '⭐', goProducts: '🛍️', toNeutral: '🤍', softer: '🌿', stronger: '💥', startAR: '💄',
  nextShade: '🎨', revert: '↩️', compare: '👀', dual: '⚖️', zoom: '🔍', retry: '🔄',
  prefSoft: '🌙', prefBold: '✨', prefKeep: '👌', keepBest: '💖', noThanks: '👌',
  keepYes: '💖', keepNo: '👉', usePref: '💡', ctxSkip: '🤐',
  audWomen: '💄', audMen: '🧴', audAny: '🙌', audKeep: '👍', whyAud: '🤖',
};
const CTX = {
  bright: '😊', calm: '😌', tired: '😪', nervous: '😣',
  hot: '☀️', humid: '🌧️', mild: '🌤️', cold: '❄️',
  work: '💼', meeting: '🎤', date: '💕', party: '🥂', errand: '🛍️',
};

export function optEmoji(o) {
  if (!o) return '';
  if (o.key === 'opt.ctxYes') return '👍';
  if (/^ctx(Mood|Weather|Plan)$/.test(o.act)) return CTX[o.val] || '💬';
  return ACT[o.act] || '';
}
