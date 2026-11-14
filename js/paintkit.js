/**
 * 自己畫的工具組：像真的化妝一樣，先選化妝品，再選用什麼塗
 *
 * 參考「おじさんメイク」的工具設計：種類 → 化妝品 → 塗抹工具（大海綿／中刷子／小指尖）三層，
 * 每個工具有自己的筆觸（大小、濃淡、邊緣軟硬）和一句用法；另外有卸妝（一次擦淡一點）、暈染、左右鏡像。
 * 這裡只有設定與換算，不碰畫面。文案在 i18n：paint.kit.<部位>.<工具>、paint.kit.<部位>.<工具>.h
 */

/** 粗細四段（對應 S.brush.size 的 0–100） */
export const PAINT_SIZES = [16, 34, 56, 80];
/** 模式：上色、暈染（把邊界推開）、卸妝（擦掉自己畫的，一次淡一點） */
export const PAINT_MODES = ['paint', 'smudge', 'erase'];

/**
 * 每個部位三種塗抹工具，由細到粗。
 * r 筆觸大小的倍率；a 一筆的濃度倍率；hard 邊緣軟硬（1 = 整個筆觸一樣濃，越小越暈）；icon 工具圖示
 */
export const PAINT_KIT = {
  lip: [
    { id: 'brush', icon: 'lipBrush', r: 0.6, a: 1.15, hard: 0.8 },      // 唇刷：細、邊緣清楚，描唇線
    { id: 'stick', icon: 'lipstick', r: 1, a: 1, hard: 0.6 },           // 口紅直塗：快、飽滿
    { id: 'finger', icon: 'hand', r: 1.25, a: 0.55, hard: 0.3 },        // 指腹：輕拍，淡而暈
  ],
  eye: [
    { id: 'detail', icon: 'eyeBrush', r: 0.5, a: 1.1, hard: 0.75 },     // 細節刷：睫毛根、眼尾
    { id: 'brush', icon: 'eyeBrush', r: 1, a: 1, hard: 0.55 },          // 眼影刷：鋪色
    { id: 'blend', icon: 'blushBrush', r: 1.6, a: 0.55, hard: 0.3 },    // 暈染刷：大範圍、淡
  ],
  cheek: [
    { id: 'finger', icon: 'hand', r: 0.7, a: 0.8, hard: 0.4 },          // 指腹：定點
    { id: 'brush', icon: 'blushBrush', r: 1, a: 1, hard: 0.45 },        // 腮紅刷
    { id: 'sponge', icon: 'sponge', r: 1.45, a: 0.6, hard: 0.3 },       // 海綿：大範圍、最淡
  ],
};
/** 預設用中間那支 */
export const defaultKit = (part) => PAINT_KIT[part][1].id;
export function kitOf(part, id) {
  return PAINT_KIT[part].find((k) => k.id === id) || PAINT_KIT[part][1];
}

/**
 * 一筆實際的參數。base：顏色、基本大小與濃度（來自商品與粗細）。
 * 卸妝：固定力道，一次擦掉三成；暈染：不加顏色，只把已經畫的推開。
 */
export function paintOpts(base, kit, mode = 'paint') {
  const radius = base.radius * kit.r;
  if (mode === 'erase') return { ...base, radius, alpha: 0.3, hard: 0.5, erase: true };
  if (mode === 'smudge') return { ...base, radius: radius * 1.1, alpha: 1, smudge: true };
  return { ...base, radius, alpha: base.alpha * kit.a, hard: kit.hard };
}

/** 左右鏡像：臉部貼圖左右對稱（u = 0.5 是中線），另一邊就是 1 − u */
export const mirrorUV = (u, v) => [1 - u, v];
