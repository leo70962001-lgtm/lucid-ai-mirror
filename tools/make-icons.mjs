/**
 * 產生 App 圖示（PWA 安裝到主畫面用）：node tools/make-icons.mjs
 *
 * 這台機器沒有影像工具，所以圖示用程式畫：粉色漸層底、白色鏡框（橢圓）、
 * 鏡中一對唇、右上角一顆閃光 —— 「AI 美妝鏡」。每個像素 4×4 超取樣做反鋸齒，
 * 再用 Node 內建的 zlib 編成 PNG。產出放在 icons/，有改設計才需要重跑。
 *
 *   icon-192.png / icon-512.png   一般圖示（圓角）
 *   icon-maskable-512.png         Android 自適應圖示（滿版，主體縮在中間 80% 安全區）
 *   apple-touch-icon.png          iOS 主畫面（180，不留透明 —— iOS 會自己切圓角）
 *   favicon-32.png                分頁小圖示
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const TOP = [0xe8, 0x9c, 0xb0], BOT = [0xc0, 0x5f, 0x7e];   // 主題粉（--primary-1 → --primary-2 再深一點）
const LIP = [0xb8, 0x45, 0x63];

const CRC = (() => {
  const T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  return (buf) => { let c = 0xffffffff; for (const b of buf) c = T[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();
function png(w, h, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;   // 8 bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * 在 0..1 的座標裡判斷一點是什麼：回傳 [r,g,b,a] 或 null（透明）
 * @param round 圓角比例（0 = 滿版方形）  @param k 主體縮放（maskable 要縮進安全區）
 */
function shade(x, y, { round, k }) {
  // 底：圓角方形
  if (round > 0) {
    const r = round, qx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0), qy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
    if (qx * qx + qy * qy > r * r) return null;
  }
  const t = y;
  let col = TOP.map((c, i) => c + (BOT[i] - c) * t);
  // 主體座標：以中心縮放
  const u = (x - 0.5) / k, v = (y - 0.52) / k;
  // 鏡框：橢圓環
  const ex = u / 0.30, ey = v / 0.36, er = Math.hypot(ex, ey);
  const ring = Math.abs(er - 1) * 0.30 < 0.028;
  // 唇：上唇兩個唇峰（中間凹）、下唇半橢圓
  const lu = u / 0.19, lv = (v - 0.05) / 0.19;
  const lower = lv >= 0 && lu * lu + (lv / 0.62) ** 2 <= 1;
  const upper = lv < 0 && lu * lu + (lv / 0.48) ** 2 <= 1 && !(Math.hypot(lu, lv + 0.62) < 0.22);   // 人中凹
  const seam = Math.abs(lv) < 0.035 && Math.abs(lu) < 0.95;
  // 閃光：右上角的四角星（星形線）
  const sx = (u - 0.27) / 0.10, sy = (v + 0.31) / 0.10;
  const star = Math.sqrt(Math.abs(sx)) + Math.sqrt(Math.abs(sy)) < 1;
  if (ring || star) col = [255, 255, 255];
  else if (seam && (upper || lower || Math.abs(lv) < 0.035)) col = LIP.map((c) => c * 0.72);   // 口縫：比唇色深一點的線
  else if (upper || lower) col = LIP;
  return [...col, 255];
}

function render(size, opt) {
  const S = 4, buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const c = shade((px + (sx + 0.5) / S) / size, (py + (sy + 0.5) / S) / size, opt);
      if (!c) continue;
      r += c[0]; g += c[1]; b += c[2]; a += 255;
    }
    const n = S * S, k = (py * size + px) * 4;
    if (a) { buf[k] = r / (a / 255); buf[k + 1] = g / (a / 255); buf[k + 2] = b / (a / 255); }
    buf[k + 3] = a / n;
  }
  return png(size, size, buf);
}

mkdirSync(OUT, { recursive: true });
const files = [
  ['icon-192.png', 192, { round: 0.22, k: 1 }],
  ['icon-512.png', 512, { round: 0.22, k: 1 }],
  ['icon-maskable-512.png', 512, { round: 0, k: 0.78 }],
  ['apple-touch-icon.png', 180, { round: 0, k: 0.92 }],
  ['favicon-32.png', 32, { round: 0.22, k: 1.1 }],
];
for (const [name, size, opt] of files) {
  writeFileSync(join(OUT, name), render(size, opt));
  console.log('icons/' + name, size + '×' + size);
}
