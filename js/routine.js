/**
 * 「一步一步帶你畫」：AI 引導 × AR × 學習，三件事合在同一個流程裡
 *
 * 以前的 AR 是「整組妝直接上好，你再慢慢調」。對第一次化妝的人，這等於跳過了學習：
 * 看到結果，但不知道為什麼、也不知道自己在家怎麼畫。
 *
 * 引導模式改成一層一層加上去：
 *   先看素顏 → 眼影 → 腮紅 → 唇，每一步都
 *     1. 在鏡子上圈出要畫的地方（AR 的用處：指的是「你的臉」，不是示意圖）
 *     2. 說一句怎麼做、一句常見的失誤（學習）
 *     3. 那一層才出現在鏡子裡（看得到每一層的差別）
 *   每一步都可以「自己畫這一步」進手動上妝，或是跳過。
 *
 * 一次只講一件事。步驟數寫在句子裡（步驟 2／4），使用者永遠知道還剩幾步。
 */

const ORDER = ['eye', 'cheek', 'lip'];
const routineLine = (kind, key, params) => ({ kind, key, params: params || {} });

/**
 * 依「這個人今天要試的這組妝」排出步驟。
 * 沒有的品項就不排（男士妝沒有眼影時，不會出現一個空步驟）。
 */
export function buildRoutine({ picks = null, look = null, amount = null } = {}) {
  const steps = [{ id: 'prep', cat: null, mark: 'skin' }];
  for (const cat of ORDER) {
    if (!picks?.[cat]) continue;
    const target = amount?.[cat] ?? look?.intensity?.[cat] ?? 0.5;
    if (target <= 0) continue;
    steps.push({ id: cat, cat, mark: cat, product: picks[cat], amount: target });
  }
  steps.push({ id: 'done', cat: null, mark: null });
  return steps;
}

/** 這一步要說的話：第幾步、做什麼、常見的失誤；有商品的話講出是哪一支 */
export function stepLines(steps, i) {
  const step = steps?.[i];
  if (!step) return [];
  const n = steps.length - 2;                    // 中間那幾層才算「步驟」，頭尾不算
  const at = Math.min(i, n);
  const out = [];
  if (step.id === 'prep') out.push(routineLine('fact', 'adv.guide.prep', { n }));
  else if (step.id === 'done') out.push(routineLine('praise', 'adv.guide.done', { n }));
  else out.push(routineLine('fact', 'adv.guide.step', { i: at, n, part: 'sl.' + step.cat, shade: step.product?.id }));
  out.push(routineLine('tip', 'guide.' + step.id + '.do', {}));
  out.push(routineLine('tip', 'guide.' + step.id + '.tip', {}));
  return out;
}

/** 這一步可以做什麼：下一步（最後一步改成「完成」）、自己畫這一步、跳過、結束引導 */
export function stepOpts(steps, i) {
  const step = steps?.[i];
  if (!step) return [];
  if (step.id === 'done') return [{ key: 'opt.guideEnd', act: 'guideEnd' }];
  const last = i >= steps.length - 2;
  const o = [{ key: last ? 'opt.guideFinish' : 'opt.guideNext', act: 'guideNext' }];
  if (step.cat) o.push({ key: 'opt.guidePaint', act: 'guidePaint' }, { key: 'opt.guideSkip', act: 'guideSkip' });
  o.push({ key: 'opt.guideEnd', act: 'guideEnd' });
  return o;
}

/** 引導結束時的回顧：走完幾步、哪幾個部位 —— 回家可以照這個順序畫 */
export function routineRecap(steps, done) {
  const parts = (steps || []).filter((s) => s.cat && done?.has(s.id)).map((s) => 'sl.' + s.cat);
  if (!parts.length) return [];
  return [routineLine('fact', 'adv.guide.recap', { n: parts.length, parts })];
}
