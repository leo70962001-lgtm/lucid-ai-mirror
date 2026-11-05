/**
 * 化妝指導：化妝品 → 工具 → 手法，從粗到細
 *
 * 只給一張「AI 建議的成品照」對使用者一點用都沒有 —— 看得到結果，但不知道怎麼做到。
 * 真正要回答的是三件事：用什麼化妝品、用什麼工具、手怎麼動。
 * 手法又依手邊的工具分三種：
 *   full 工具齊全        用對應的刷具
 *   sub  工具不齊全      這個部位沒有對應工具，用替代品（棉花棒、化妝棉、粉撲）
 *   none 完全沒有工具    手指＋紙巾
 * 每個部位都分兩段：先粗（大範圍上色）→ 再細（收邊、暈開、對稱）。
 *
 * 這裡只有判斷與文案鍵，不碰畫面。文案在 i18n：
 *   coach.<part>.<method>.coarse / .fine、coach.<part>.tip、coach.tool.<tool>、coach.sub.<part>、coach.none.<part>
 */

export const COACH_PARTS = ['base', 'eye', 'cheek', 'lip'];
export const COACH_MODES = ['full', 'some', 'none'];
export const PART_TOOL = { base: 'sponge', eye: 'eyeBrush', cheek: 'blushBrush', lip: 'lipBrush' };
export const COACH_TOOLS = Object.values(PART_TOOL);
/** 先粗這一段先上到目標濃度的多少：看得到位置與範圍，但還沒完成 */
export const COARSE_RATIO = 0.55;

/** 這個部位該教哪一種手法。mode = some 時，有這支工具才算齊全 */
export function coachMethod(part, mode, owned = new Set()) {
  if (mode === 'none') return 'none';
  if (mode === 'some' && !owned.has(PART_TOOL[part])) return 'sub';
  return 'full';
}

/** 這個部位這種手法用什麼工具（文案鍵） */
export function coachToolKey(part, method) {
  if (method === 'none') return 'coach.none.' + part;
  if (method === 'sub') return 'coach.sub.' + part;
  return 'coach.tool.' + PART_TOOL[part];
}

/**
 * 整份指南：有哪幾個部位、各用哪支化妝品、什麼工具、先粗再細怎麼做。
 * 底妝不在商品目錄裡，用「你平常用的底妝」；沒有的品項或濃度是 0 的部位不列。
 */
export function coachPlan({ picks = null, amount = null, mode = 'full', owned = new Set() } = {}) {
  const out = [];
  for (const part of COACH_PARTS) {
    const product = part === 'base' ? null : picks?.[part] || null;
    if (part !== 'base' && (!product || (amount?.[part] ?? 1) <= 0)) continue;
    const method = coachMethod(part, mode, owned);
    out.push({
      part, product, method, toolKey: coachToolKey(part, method),
      coarseKey: `coach.${part}.${method}.coarse`, fineKey: `coach.${part}.${method}.fine`, tipKey: `coach.${part}.tip`,
    });
  }
  return out;
}
