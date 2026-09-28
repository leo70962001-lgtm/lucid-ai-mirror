/**
 * 二選一找命定色
 *
 * 鏡子切成左右兩半、各上一支唇色，問「左邊還是右邊？」—— 三輪，每輪只比一件事：
 *   第 1 輪比冷暖、第 2 輪比深淺、第 3 輪比鮮豔或柔和。
 * 贏的那支留下來，跟下一輪的挑戰者比。三輪後剩下的就是今天的命定色。
 *
 * 為什麼每輪只比一件事：一次差太多件事，選完也說不出自己喜歡的是什麼；
 * 一次只變一個方向，選完就知道「原來我喜歡偏冷的」—— 這是有資訊的好玩，不是純遊戲。
 * （研究也指出：AR 試妝裡「資訊量」是最強的使用意願來源，好玩要適度，太花俏反而降低信任。
 *   Micheletto et al., Frontiers in Virtual Reality 2025, doi:10.3389/frvir.2025.1515937）
 *
 * 選擇會以「自己挑」的權重記進喜好學習（見 js/lipcolor.js）。
 */

import { lipMetrics } from './lipcolor.js';

export const DUEL_AXES = ['warm', 'deep', 'vivid'];

/** 跟 lipcolor.js 喜好學習同一把尺 */
function duelAxes(p) {
  const { h, C, L } = lipMetrics(p);
  return { warm: (h - 24) / 16, deep: (52 - L) / 12, vivid: (C - 42) / 14 };
}

/**
 * 下一輪：目前的贏家 vs 在這一輪那個方向上跟它差最多、還沒上場過的色號。
 * 差不到 0.3 就換下一個方向（那兩支在這個方向上幾乎一樣，比了也沒意義）。
 * 沒有可以比的就回 null（結束）。
 */
export function nextDuel(products, winner, used, round) {
  const pool = (products || []).filter((p) => p.cat === 'lip' && p.stock > 0 && p.id !== winner?.id && !used.has(p.id));
  if (!winner || !pool.length) return null;
  const w = duelAxes(winner);
  for (let r = round; r < DUEL_AXES.length; r++) {
    const axis = DUEL_AXES[r];
    const best = pool.map((p) => ({ p, d: Math.abs(duelAxes(p)[axis] - w[axis]) })).sort((a, b) => b.d - a.d)[0];
    if (best && best.d >= 0.3) return { round: r, axis, a: winner, b: best.p };
  }
  return null;
}

/** 這一輪兩支各自落在這個方向的哪一邊（給人聽的字） */
export function duelSides(d) {
  const va = duelAxes(d.a)[d.axis], vb = duelAxes(d.b)[d.axis];
  const word = { warm: ['warm', 'cool'], deep: ['deep', 'light'], vivid: ['vivid', 'soft'] }[d.axis];
  return { a: va >= vb ? word[0] : word[1], b: va >= vb ? word[1] : word[0] };
}

const duelLine = (kind, key, params) => ({ kind, key, params: params || {} });

export function duelLines(d, i, n) {
  const s = duelSides(d);
  return [duelLine('fact', 'adv.duel.round', { i, n, axis: 'duel.axis.' + d.axis, a: d.a.id, b: d.b.id,
                                              sa: 'duel.side.' + s.a, sb: 'duel.side.' + s.b }),
          duelLine('ask', 'adv.duel.q', {})];
}

export const duelOpts = () => [{ key: 'opt.duelLeft', act: 'duelLeft' }, { key: 'opt.duelRight', act: 'duelRight' },
                                { key: 'opt.duelEnd', act: 'duelEnd' }];

/** 選完之後的那一句：你選的是哪一邊的，下一輪要比什麼 */
export function duelPicked(d, left) {
  const s = duelSides(d);
  return duelLine('told', 'adv.duel.picked', { shade: (left ? d.a : d.b).id, side: 'duel.side.' + (left ? s.a : s.b) });
}
