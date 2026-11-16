/**
 * 拍照前的環境光檢查：光線色偏越小，膚色與試色越準
 *
 * 拍完之後本來就會用眼白校正白平衡，但校正有極限 —— 有色光、太暗、半邊臉在陰影裡，
 * 補償過頭反而更不準。所以在取景時就先量，告訴使用者現在的光線好不好、往哪個方向改，
 * 而且邊移動邊回饋（越來越好／剛才那邊比較好），把人帶到色偏小的地方。
 *
 * 量三件事：
 *   色偏  眼白是全臉最接近中性色的地方，它偏什麼顏色，光就偏什麼顏色
 *   亮度  臉頰的亮度：太暗雜訊多、太亮會過曝
 *   均勻  左右臉頰的亮度差：側光會讓半邊臉的顏色不準
 * 這裡只有判斷，不碰畫面；取樣在 app.js。門檻是估的，沒有用色度計校正過。
 */
const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lumOf = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

export const LIGHT = {
  castOk: 0.2, castBad: 0.45,       // 眼白的色偏（對數比例的距離）：約 1.2 倍以內算好
  dark: 0.1, bright: 0.72,          // 臉頰的線性亮度
  uneven: 0.35,                     // 左右臉頰亮度差的比例
  good: 75, fair: 50,               // 分數門檻
};

/** 眼白的色偏：大小與方向（warm 偏黃紅、cool 偏藍、green 偏綠、magenta 偏洋紅） */
export function castOf(rgb) {
  if (!rgb) return null;
  const R = Math.max(lin(rgb[0]), 1e-4), G = Math.max(lin(rgb[1]), 1e-4), B = Math.max(lin(rgb[2]), 1e-4);
  const r = Math.log(R / G), b = Math.log(B / G);
  const size = Math.hypot(r, b);
  let dir = 'neutral';
  if (size >= 0.05) {
    if (r < 0 && b < 0 && Math.abs(r - b) < Math.min(-r, -b) * 1.5) dir = 'green';
    else if (r > 0 && b > 0 && Math.abs(r - b) < Math.min(r, b) * 1.5) dir = 'magenta';
    else dir = r > b ? 'warm' : 'cool';
  }
  return { size, dir };
}

/**
 * 現在的光線好不好。
 * @param sclera 眼白的平均色 [r,g,b]（量不到傳 null：只看亮度與均勻）
 * @param left、right 左右臉頰的平均色
 * @returns score 0–100；level good|fair|poor；issue 最該先改的一件事（null = 沒問題）；cast、lum、uneven 原始值
 */
export function lightQuality({ sclera = null, left, right }) {
  const yl = lumOf(left), yr = lumOf(right), lum = (yl + yr) / 2;
  const uneven = Math.abs(yl - yr) / Math.max(yl, yr, 1e-4);
  const cast = castOf(sclera);
  const pen = {
    dark: lum < LIGHT.dark ? Math.min(45, (LIGHT.dark - lum) / LIGHT.dark * 60 + 15) : 0,
    bright: lum > LIGHT.bright ? Math.min(40, (lum - LIGHT.bright) / (1 - LIGHT.bright) * 50 + 15) : 0,
    uneven: uneven > LIGHT.uneven ? Math.min(30, (uneven - LIGHT.uneven) * 60 + 12) : 0,
    cast: cast && cast.size > LIGHT.castOk ? Math.min(60, (cast.size - LIGHT.castOk) * 130 + 10) : 0,
  };
  const score = Math.max(0, Math.round(100 - pen.dark - pen.bright - pen.uneven - pen.cast));
  const worst = Object.entries(pen).sort((a, b) => b[1] - a[1])[0];
  const issue = worst[1] <= 0 ? null : worst[0] === 'cast' ? cast.dir : worst[0];
  return { score, level: score >= LIGHT.good ? 'good' : score >= LIGHT.fair ? 'fair' : 'poor', issue, cast, lum, uneven, known: !!cast };
}

/** 邊移動邊回饋：跟剛才比是變好還是變差（差不到 4 分不講，免得一直跳） */
export function lightTrend(prev, cur) {
  if (prev == null) return 'same';
  return cur - prev >= 4 ? 'up' : prev - cur >= 4 ? 'down' : 'same';
}

/** 一小塊的平均色（取樣用） */
export function patchRGB(ctx, x, y, r) {
  const x0 = Math.max(0, Math.round(x - r)), y0 = Math.max(0, Math.round(y - r)), w = Math.max(1, Math.round(r * 2));
  const d = ctx.getImageData(x0, y0, w, w).data;
  let R = 0, G = 0, B = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
  return n ? [R / n, G / n, B / n] : [0, 0, 0];
}

/**
 * 寬鬆的眼白取樣：眼睛範圍裡最亮的三成像素。
 * 分析用的眼白取樣（estimateIlluminant）會把彩度高的像素當成「不是眼白」丟掉 ——
 * 但燈光很黃時眼白本身就帶色，剛好是最需要提醒的時候量不到。這裡只用來判斷色偏方向，不拿去做校正。
 * lm：正規化的臉部點位。量不到回 null。
 */
const EYE_BOX = [[33, 133, 159, 145], [263, 362, 386, 374]];
export function scleraLoose(ctx, lm, W, H) {
  const px = [];
  for (const ids of EYE_BOX) {
    const pts = ids.map((i) => lm[i]).filter(Boolean);
    if (pts.length < 4) continue;
    const xs = pts.map((p) => p.x * W), ys = pts.map((p) => p.y * H);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const w = Math.min(W - x0, Math.ceil(Math.max(...xs)) - x0), h = Math.min(H - y0, Math.ceil(Math.max(...ys)) - y0);
    if (w < 4 || h < 2) continue;
    const d = ctx.getImageData(x0, y0, w, h).data;
    for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) >= 60) px.push([d[i], d[i + 1], d[i + 2]]);
  }
  if (px.length < 24) return null;
  px.sort((a, b) => (b[0] + b[1] + b[2]) - (a[0] + a[1] + a[2]));
  const keep = px.slice(0, Math.max(8, Math.floor(px.length * 0.3)));
  return keep.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v / keep.length);
}
