/**
 * 問 AI：打字問問題，或用標籤（#美妝教學、#唇妝…）找教學
 *
 * 這台機器要離線也能用，所以不是生成式 AI，而是「關鍵字 → 整理好的答案」：
 * 問題裡出現的關鍵字越長越具體，分數越高。答案全部是寫好、三種語言都有的句子，
 * 不會亂編；查不到就老實說，並給標籤讓人自己找。
 *
 * 答案來源：美妝小教室（learn.js）、化妝指導的手法（coach.js）、下面這幾題常見問題（qa.<id>.q / .a）。
 */
import { LESSONS, lessonLines } from './learn.js';
import { coachMethod } from './coach.js';

export const QA_TAGS = ['teach', 'lip', 'eye', 'cheek', 'base', 'tools', 'color', 'lasting', 'beginner', 'men'];

/** 小教室每一課的標籤與關鍵字（中／英／日都放，用哪種語言問都查得到） */
const LESSON_META = {
  order:      ['teach beginner', '順序|先後|步驟|\\border\\b|\\bsteps\\b|順番|手順'],
  base:       ['base beginner', '底妝|粉底|遮瑕|foundation|concealer|ファンデ|下地'],
  lipBlot:    ['lip lasting', '抿|紙巾|掉色|blot|tissue|ティッシュ|色落ち'],
  blushLess:  ['cheek beginner', '腮紅太|太紅|too much blush|チーク.*濃'],
  eyeGrad:    ['eye teach', '漸層|暈染|gradient|blend|グラデ'],
  brow:       ['teach', '眉|brow|眉毛'],
  lipLine:    ['lip', '唇線|唇形|lip line|liner|リップライン'],
  lipFinish:  ['lip color', '霧面|水光|質地|matte|gloss|finish|マット|ツヤ|質感'],
  mlbb:       ['lip beginner', 'mlbb|裸色|自然色|nude|ヌード'],
  lipOwn:     ['lip color', '唇色深|唇色|暗沉|dark lips|唇の色'],
  lipLayer:   ['lip', '疊色|混色|\\blayer|重ね'],
  lipCare:    ['lip beginner', '唇乾|脫皮|護唇|dry lips|chapped|balm|リップケア|乾燥'],
  lipTest:    ['lip color', '試色|手背|swatch|\\btest\\b|試し'],
  lasting:    ['lasting', '持久|脫妝|暈開|\\blast|long.?wear|smudge|崩れ|長持ち'],
  seasonUse:  ['color', '季節色|春夏秋冬|seasonal|季節|パーソナルカラー'],
  seasonMyth: ['color', '只能擦|禁忌|不能擦|\\bmyth|must not|ダメな色'],
  selfCheck:  ['color', '冷調|暖調|底調|undertone|cool|warm|ブルベ|イエベ'],
  lightCheck: ['color', '光線|燈光|自然光|lighting|daylight|照明'],
  menGroom:   ['men', '男|\\bmen\\b|\\bmale\\b|メンズ'],
};

/** 手法與常見問題。part：照手邊工具回答手法；answers：固定的答案 */
const EXTRA = [
  { id: 'howBase',  tags: 'base teach',  part: 'base',  kw: '底妝怎麼|怎麼上底妝|how.*foundation|ファンデ.*塗' },
  { id: 'howEye',   tags: 'eye teach',   part: 'eye',   kw: '眼影|眼妝|eyeshadow|eye shadow|eye makeup|アイシャドウ|アイメイク' },
  { id: 'howCheek', tags: 'cheek teach', part: 'cheek', kw: '腮紅|blush|チーク' },
  { id: 'howLip',   tags: 'lip teach',   part: 'lip',   kw: '口紅|唇膏|唇妝|唇釉|擦嘴|lipstick|gloss|lip makeup|口紅|リップ' },
  { id: 'noBrush',  tags: 'tools beginner teach', kw: '沒有刷|沒刷|沒工具|沒有工具|替代|手指|棉花棒|紙巾|no brush|without.*brush|without.*tool|substitute|finger|cotton swab|ブラシがな|道具がな|代わり|綿棒|指で' },
  { id: 'tools',    tags: 'tools beginner',  kw: '工具|刷具|要買什麼|買哪些|what tools|which brushes|道具|ブラシ.*何|何を買' },
  { id: 'clean',    tags: 'tools',       kw: '洗刷|清潔|多久洗|clean.*brush|wash.*brush|ブラシ.*洗' },
  { id: 'fix',      tags: 'lip teach',   kw: '塗出去|畫出去|超出|畫歪|outside.*line|went over|fix.*mistake|はみ出' },
  { id: 'tooRed',   tags: 'cheek',       kw: '太紅|太濃|畫太|too red|too heavy|too strong|濃すぎ|赤すぎ' },
  { id: 'cakey',    tags: 'base',        kw: '卡粉|浮粉|cakey|caking|粉浮き|ヨレ' },
  { id: 'accurate', tags: 'color',       kw: '準不準|準嗎|顏色準|一樣嗎|accurate|same as real|実物|正確' },
  { id: 'privacy',  tags: 'teach',       kw: '上傳|隱私|照片.*存|upload|privacy|プライバシー|アップロード' },
];


export const QA_KB = [
  ...LESSONS.filter((l) => LESSON_META[l.id]).map((l) => ({
    id: 'l:' + l.id, tags: LESSON_META[l.id][0].split(' '), kw: LESSON_META[l.id][1], titleKey: `learn.${l.id}.name`, lesson: l,
  })),
  ...EXTRA.map((x) => ({ id: 'x:' + x.id, tags: x.tags.split(' '), kw: x.kw, titleKey: `qa.${x.id}.q`, part: x.part || null, answerKey: x.part ? null : `qa.${x.id}.a` })),
];

/** 問題比對到的關鍵字總長度：比對得越具體，分數越高 */
function qaScore(entry, q) {
  let s = 0;
  for (const k of entry.kw.split('|')) {
    const m = q.match(new RegExp(k, 'i'));
    if (m) s += m[0].length;
  }
  return s && entry.part ? s + 2 : s;     // 問題講到部位（沒有刷子怎麼畫眼影）：回答那個部位的手法
}

/** 打字問：回傳分數由高到低的條目（沒比對到的不回） */
export function qaSearch(q) {
  const text = String(q || '').trim();
  if (!text) return [];
  return QA_KB.map((entry) => ({ entry, score: qaScore(entry, text) }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.entry);
}

/** 按標籤：這個標籤底下的教學（手法排前面，最多 5 個） */
export function qaByTag(tag) {
  return QA_KB.filter((e) => e.tags.includes(tag))
    .sort((a, b) => (b.part ? 1 : 0) - (a.part ? 1 : 0)).slice(0, 5);
}

/** 問題裡有講自己的狀況（沒工具、用手指）就照那個講，不然照工具設定 */
export function qaMethod(q, part, mode, owned) {
  const text = String(q || '');
  if (/手指|指腹|沒有工具|沒工具|finger|no tool|without.*tool|指で|道具がな/i.test(text)) return 'none';
  if (/替代|棉花棒|沒有刷|沒刷|substitute|cotton|no brush|without.*brush|綿棒|代わり|ブラシがな/i.test(text)) return 'sub';
  return coachMethod(part, mode || 'full', owned || new Set());
}

/** 條目 → AI 要講的句子 */
export function qaLines(entry, { q = '', mode = 'full', owned = new Set(), season = null } = {}) {
  if (!entry) return [];
  if (entry.lesson) return lessonLines(entry.lesson, season);
  if (entry.part) {
    const m = qaMethod(q, entry.part, mode, owned);
    return [{ kind: 'tip', key: `coach.${entry.part}.${m}.coarse`, params: {} },
            { kind: 'tip', key: `coach.${entry.part}.${m}.fine`, params: {} },
            { kind: 'caution', key: `coach.${entry.part}.tip`, params: {} }];
  }
  return [{ kind: 'tip', key: entry.answerKey, params: {} }];
}
