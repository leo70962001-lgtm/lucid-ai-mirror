/**
 * 化妝指導流程：AI 引導 × AR × 學習，三件事合在同一個流程裡
 *
 * 以前的 AR 是「整組妝直接上好，你再慢慢調」。看到結果，但不知道自己在家怎麼畫。
 * 這個流程從「你手邊有什麼工具」開始，然後從無到有：
 *   問工具 → 備好化妝品與工具 → 底妝 → 眼影 → 腮紅 → 唇 → 完成
 * 每個部位都是先粗再細：
 *   先粗：鏡子上圈出位置，這一層淡淡出現（看得到範圍），講大範圍怎麼上、用什麼工具
 *   再細：這一層到位，講收邊、暈開、對稱，以及常見的失誤
 * 手法照工具走（見 coach.js）；這一步沒有工具可以當場換成替代品。
 * 一次只講一件事，步驟數寫在句子裡（步驟 2／4），使用者永遠知道還剩幾步。
 */
import { COACH_PARTS, coachMethod, coachToolKey, PART_TOOL, COACH_TOOLS } from './coach.js';

const routineLine = (kind, key, params) => ({ kind, key, params: params || {} });

/**
 * 依「這個人今天要試的這組妝」排出步驟。
 * 底妝一定有（鏡子不畫底妝，用說的）；沒有的品項或濃度是 0 的部位不排。
 */
export function buildRoutine({ picks = null, look = null, amount = null } = {}) {
  const steps = [{ id: 'prep', cat: null, mark: 'skin' }];
  for (const part of COACH_PARTS) {
    if (part === 'base') { steps.push({ id: 'base', cat: null, mark: 'skin' }); continue; }
    if (!picks?.[part]) continue;
    const target = amount?.[part] ?? look?.intensity?.[part] ?? 0.5;
    if (target <= 0) continue;
    steps.push({ id: part, cat: part, mark: part, product: picks[part], amount: target });
  }
  steps.push({ id: 'done', cat: null, mark: null });
  return steps;
}

/** 開始之前先問：工具有多少？答案決定後面教哪一種手法 */
export const toolModeOpts = () => [
  { key: 'opt.coachFull', act: 'coachFull' },
  { key: 'opt.coachSome', act: 'coachSome' },
  { key: 'opt.coachNone', act: 'coachNone' },
];

/** 只有一部分工具：點一下打勾（不講話、不洗版），勾好按開始 */
export const ownedOpts = (owned) => [
  ...COACH_TOOLS.map((tool) => ({ key: 'coach.tool.' + tool, act: 'coachToggle', tool, silent: true, on: owned.has(tool) })),
  { key: 'opt.coachToolsDone', act: 'coachToolsDone' },
];

/** 備料：這次會用到哪些化妝品、哪些工具 */
function kitLines(steps, ctx) {
  const parts = steps.filter((s) => s.id !== 'prep' && s.id !== 'done');
  const kit = parts.filter((s) => s.product).map((s) => ['coach.part.' + s.id, s.product.id]);
  const tools = [...new Set(parts.map((s) => coachToolKey(s.id, coachMethod(s.id, ctx.mode, ctx.owned))))];
  return [routineLine('fact', 'adv.coach.kit', { n: parts.length }),
          routineLine('tip', 'adv.coach.kitItems', { kit }),
          routineLine('tip', 'adv.coach.kitTools', { parts: tools })];
}

/**
 * 這一步要說的話。
 * @param ctx { stage: 'coarse' | 'fine', mode, owned }
 */
export function stepLines(steps, i, ctx = {}) {
  const step = steps?.[i];
  if (!step) return [];
  if (step.id === 'prep') return kitLines(steps, ctx);
  const n = steps.length - 2;                    // 頭尾不算步驟
  if (step.id === 'done') return [routineLine('praise', 'adv.guide.done', { n })];
  const method = coachMethod(step.id, ctx.mode, ctx.owned);
  if (ctx.stage === 'fine') {
    return [routineLine('tip', `coach.${step.id}.${method}.fine`),
            routineLine('caution', `coach.${step.id}.tip`)];
  }
  return [routineLine('fact', 'adv.coach.step', { i, n, part: 'coach.part.' + step.id, tool: coachToolKey(step.id, method) }),
          routineLine('tip', `coach.${step.id}.${method}.coarse`)];
}

/** 這一步可以做什麼：再細一點、下一步、自己畫、沒有這支工具、跳過、結束 */
export function stepOpts(steps, i, ctx = {}) {
  const step = steps?.[i];
  if (!step) return [];
  if (step.id === 'done') return [{ key: 'opt.guideEnd', act: 'guideEnd' }];
  if (step.id === 'prep') return [{ key: 'opt.coachStart', act: 'guideNext' }, { key: 'opt.guideEnd', act: 'guideEnd' }];
  const paint = step.cat ? [{ key: 'opt.guidePaint', act: 'guidePaint' }] : [];
  if (ctx.stage === 'fine') {
    const last = i >= steps.length - 2;
    return [{ key: last ? 'opt.guideFinish' : 'opt.guideNext', act: 'guideNext' }, ...paint, { key: 'opt.guideEnd', act: 'guideEnd' }];
  }
  const noTool = coachMethod(step.id, ctx.mode, ctx.owned) === 'full'
    ? [{ key: 'opt.coachNoTool', act: 'coachNoTool', tool: PART_TOOL[step.id] }] : [];
  return [{ key: 'opt.coachFine', act: 'guideFine' }, ...paint, ...noTool, { key: 'opt.guideSkip', act: 'guideSkip' }, { key: 'opt.guideEnd', act: 'guideEnd' }];
}

/** 引導結束時的回顧：走完幾步、哪幾個部位 —— 回家可以照這個順序畫 */
export function routineRecap(steps, done) {
  const parts = (steps || []).filter((s) => s.id !== 'prep' && s.id !== 'done' && done?.has(s.id)).map((s) => 'coach.part.' + s.id);
  if (!parts.length) return [];
  return [routineLine('fact', 'adv.guide.recap', { n: parts.length, parts })];
}
