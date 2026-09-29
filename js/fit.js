/**
 * 照片滿版、下面疊著對話時，臉要放在哪裡（第 2 步用）。
 *
 * 照片先照 object-fit: cover 置中鋪滿，再「放大 k、往上移 ty」微調：y' = y·k + ty（以上緣為原點）。
 * 條件：下巴落在對話上緣 C；照片下緣蓋到畫面底 FH（不露空白）；額頭不低於 TOP（左上主播膠囊）。
 * 條件衝突時以「臉完整露出」為優先 —— 寧可底下露一點深色，也不要蓋到臉。
 * @returns {{k:number, ty:number}}
 */
export function faceFit({ W, H, FW, FH, top, chin, C, TOP = 52 }) {
  const s0 = Math.max(FW / W, FH / H), oy = (FH - H * s0) / 2;
  const faceH = Math.max(1, (chin - top) * s0);
  const kMin = (FH - C) / Math.max(1, (H - chin) * s0);   // 下緣蓋滿需要的放大
  const kMax = (C - TOP) / faceH;                         // 臉塞得進去的最大放大
  const k = Math.max(0.55, Math.min(Math.max(1, kMin), kMax));
  const ty = Math.min(0, C - (oy + chin * s0) * k);       // 只往上移，上面不留空白
  return { k, ty };
}
