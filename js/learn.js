/**
 * 美妝小教室：短短兩三句的技巧，以及小測驗
 *
 * 目的是讓第一次化妝的人「做得出來」：每一課只講一件事、用動作講（「用指腹拍開」），
 * 而且配合當下 —— 正在調唇色就教唇，剛知道自己是夏季型就教季節色怎麼用。
 * 講法是建議，不是規定（「可以」「通常」），最後一句多半是常見的失誤。
 *
 * 季節相關的內容參考：
 *   メグラシ（2026）春vs秋は明るさ、夏vs冬は濁り
 *   Curate Your Style — What Is Seasonal Color Analysis?
 */

import { SEASONS, seasonOfColor } from './season.js';

const learnLine = (kind, key, params) => ({ kind, key, params: params || {} });

/**
 * 每一課：id、分類、幾句、適合誰（new = 新手優先、pro = 有經驗再學）。
 * 文案在 i18n：learn.<id>.t（標題）、learn.<id>.1…n
 */
export const LESSONS = [
  { id: 'order',      cat: 'basic',  n: 2, lvl: 'new' },
  { id: 'base',       cat: 'base',   n: 2, lvl: 'new' },
  { id: 'lipBlot',    cat: 'lip',    n: 2, lvl: 'new' },
  { id: 'blushLess',  cat: 'cheek',  n: 2, lvl: 'new' },
  { id: 'eyeGrad',    cat: 'eye',    n: 3, lvl: 'any' },
  { id: 'brow',       cat: 'brow',   n: 2, lvl: 'any' },
  { id: 'lipLine',    cat: 'lip',    n: 2, lvl: 'pro' },
  { id: 'lipFinish',  cat: 'lip',    n: 3, lvl: 'any' },
  { id: 'mlbb',       cat: 'lip',    n: 2, lvl: 'new' },
  { id: 'lipOwn',     cat: 'lip',    n: 2, lvl: 'any' },
  { id: 'lipLayer',   cat: 'lip',    n: 2, lvl: 'any' },
  { id: 'lipCare',    cat: 'lip',    n: 2, lvl: 'new' },
  { id: 'lipTest',    cat: 'lip',    n: 2, lvl: 'any' },
  { id: 'lasting',    cat: 'basic',  n: 2, lvl: 'any' },
  { id: 'seasonUse',  cat: 'season', n: 2, lvl: 'any' },
  { id: 'seasonMyth', cat: 'season', n: 2, lvl: 'any' },
  { id: 'selfCheck',  cat: 'season', n: 2, lvl: 'any' },
  { id: 'lightCheck', cat: 'basic',  n: 2, lvl: 'any' },
  { id: 'menGroom',   cat: 'men',    n: 2, lvl: 'any' },
];

/**
 * 挑下一課。依序看：
 *   1. 現在正在調的品項（AR 裡調唇就教唇）
 *   2. 剛判斷出季節、還沒學過季節色怎麼用 → 季節
 *   3. 新手先學基本功；男士先學男士保養
 * 學過的不重複；全部學過回 null。
 */
export function pickLesson({ cat = null, season = null, level = null, audience = null, learned = new Set() } = {}) {
  const open = LESSONS.filter((l) => !learned.has(l.id)
    && (audience === 'men' ? l.id !== 'lipLine' : l.id !== 'menGroom')
    && (level === 'new' ? l.lvl !== 'pro' : true));
  const want = [
    cat && open.find((l) => l.cat === cat),
    audience === 'men' && open.find((l) => l.id === 'menGroom'),
    season && open.find((l) => l.cat === 'season'),
    level === 'new' && open.find((l) => l.lvl === 'new'),
    open[0],
  ];
  return want.find(Boolean) || null;
}

/** 一課的內容：標題一句（fact），步驟與提醒（tip）。季節那一課帶上使用者的季節 */
export function lessonLines(lesson, season = null) {
  if (!lesson) return [learnLine('fact', 'learn.done', {})];
  const p = season ? { season: 'season.' + season } : {};
  return [learnLine('fact', 'learn.' + lesson.id + '.t', p),
          ...Array.from({ length: lesson.n }, (_, i) => learnLine('tip', `learn.${lesson.id}.${i + 1}`, p))];
}

// ── 小測驗 ──────────────────────────────────────────
// 固定題：觀念題，答案寫死、解說寫在 i18n（quiz.<id>.q / a0–a2 / why）
export const QUIZ = [
  { id: 'fair',   answer: 1 },   // 皮膚白就是冷調嗎？ → 不一定
  { id: 'split',  answer: 0 },   // 春季與秋季主要差在？ → 明度
  { id: 'blush',  answer: 1 },   // 腮紅一次刷足還是少量多次？ → 少量多次
  { id: 'light',  answer: 2 },   // 試色在哪裡看最準？ → 自然光
  { id: 'coolSplit', answer: 1 }, // 夏季與冬季主要差在？ → 清濁（鮮豔或柔和）
  { id: 'mlbb',   answer: 2 },   // MLBB 是什麼？ → 比原本唇色好看一點的自然色
  { id: 'lipOwn', answer: 1 },   // 唇色偏深的人擦淡裸色會怎樣？ → 顏色會被唇色蓋掉、顯得暗沉
  { id: 'matte',  answer: 0 },   // 霧面唇膏最需要注意？ → 唇紋與乾燥
];

/**
 * 出一題。優先出「這支唇色像哪一季」—— 用店裡真的有的色號、答案由實測色值算出來，
 * 只挑分得很開的色號（兩季差距 ≥ 0.2），免得出一題連機器自己都說不準的題目。
 * @param done 已經出過的題目 id
 */
export function nextQuiz(products, done = new Set()) {
  const clear = (products || [])
    .filter((p) => p.cat === 'lip' && p.stock > 0 && !done.has('shade:' + p.id))
    .map((p) => ({ p, s: seasonOfColor(p) }))
    .filter((x) => x.s.margin >= 0.2);
  if (clear.length) {
    const { p, s } = clear[0];
    return { id: 'shade:' + p.id, lines: [learnLine('ask', 'quiz.shade.q', { shade: p.id })],
             opts: SEASONS.map((x, i) => ({ key: 'season.' + x, act: 'quizAns', val: i })),
             answer: SEASONS.indexOf(s.season), why: learnLine('fact', 'quiz.shade.why.' + s.season, { shade: p.id }) };
  }
  const q = QUIZ.find((x) => !done.has(x.id));
  if (!q) return null;
  return { id: q.id, lines: [learnLine('ask', 'quiz.' + q.id + '.q', {})],
           opts: [0, 1, 2].map((i) => ({ key: `quiz.${q.id}.a${i}`, act: 'quizAns', val: i })),
           answer: q.answer, why: learnLine('fact', 'quiz.' + q.id + '.why', {}) };
}

/** 回答之後：答對先稱讚、答錯不說「錯」，說「差一點」，然後都給解說 */
export function onQuizAnswer(q, val) {
  if (!q) return { ok: false, lines: [] };
  const ok = val === q.answer;
  const answer = q.id.startsWith('shade:') ? 'season.' + SEASONS[q.answer] : `quiz.${q.id}.a${q.answer}`;
  return { ok, lines: [learnLine(ok ? 'praise' : 'fact', ok ? 'quiz.right' : 'quiz.almost', { answer }), q.why] };
}

/** 結束時的回顧：學了幾課、測驗答對幾題 */
export function learnRecap(learned, quiz) {
  const out = [];
  if (learned?.size) out.push(learnLine('fact', 'learn.recap', { n: learned.size, topics: [...learned] }));
  // 一題都沒答對時不報 0 分 —— 說「做了幾題、下次再挑戰」就好，學東西不該被分數打擊
  if (quiz?.n) out.push(quiz.ok ? learnLine(quiz.ok === quiz.n ? 'praise' : 'fact', 'quiz.score', { ok: quiz.ok, n: quiz.n })
                                : learnLine('fact', 'quiz.tried', { n: quiz.n }));
  return out;
}
