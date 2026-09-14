/**
 * 把外部依賴抓到本機：node vendor.mjs
 *
 * 櫃位機台常常沒有外網。全部資源存進 vendor/ 之後，
 * 不論是 server.js、靜態託管還是單檔版都不會再對外連線。
 */
import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

const FILES = [
  // 存成 .js 而非 .mjs：靜態主機對 .mjs 的 MIME 設定不一致，
  // 模組匯入遇到非 JavaScript MIME 會直接拒絕。
  ['vendor/vision_bundle.js',                  `${MP}/vision_bundle.mjs`],
  ['vendor/vision_wasm_internal.js',           `${MP}/wasm/vision_wasm_internal.js`],
  ['vendor/vision_wasm_internal.wasm',         `${MP}/wasm/vision_wasm_internal.wasm`],
  ['vendor/vision_wasm_nosimd_internal.js',    `${MP}/wasm/vision_wasm_nosimd_internal.js`],
  ['vendor/vision_wasm_nosimd_internal.wasm',  `${MP}/wasm/vision_wasm_nosimd_internal.wasm`],
  ['models/face_landmarker.task',
   'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'],
];

let total = 0;
for (const [rel, url] of FILES) {
  const dst = join(ROOT, rel);
  if (existsSync(dst)) {
    const n = statSync(dst).size; total += n;
    console.log(`已存在  ${rel.padEnd(44)} ${(n / 1024).toFixed(0)} KB`);
    continue;
  }
  process.stdout.write(`下載中  ${rel.padEnd(44)}`);
  const res = await fetch(url);
  if (!res.ok) { console.log(` 失敗 ${res.status}`); process.exit(1); }
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, buf);
  total += buf.length;
  console.log(` ${(buf.length / 1024).toFixed(0)} KB`);
}
console.log(`\n合計 ${(total / 1048576).toFixed(1)} MB。之後 build 與執行都不需要網路。`);
