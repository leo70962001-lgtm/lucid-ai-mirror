/**
 * 打包：node build.mjs [--online]
 *
 * 產出兩份：
 *   lucid-demo.html        單檔版，雙擊就能開
 *   dist/site/             靜態站台，整包丟上 HTTPS 空間
 *
 * 預設是**完全離線**版：MediaPipe 的 WASM（9.4 MB）、臉部模型（3.7 MB）、
 * 商品照全部內嵌，開啟後不會發出任何對外請求。檔案約 18 MB。
 * 櫃位機台常常沒有外網，一個小但打不開的檔案沒有價值。
 *
 * --online 會改成從 CDN 載入那些資源，檔案縮到約 0.8 MB，但需要網路。
 *
 * 相機（getUserMedia）只在 https:// 或 localhost 下能用，file:// 一定被
 * 瀏覽器擋掉。單檔版因此只有「上傳照片」那條路；要相機請用 start.bat
 * 或把 dist/site/ 放上 HTTPS 空間。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ONLINE = process.argv.includes('--online');
const R = (p) => readFileSync(join(ROOT, p), 'utf8');
const B = (p) => readFileSync(join(ROOT, p));
const KB = (n) => (n / 1024).toFixed(0) + ' KB';
const MB = (n) => (n / 1048576).toFixed(2) + ' MB';

const MODULES = ['js/i18n.js', 'js/products.js', 'js/context.js', 'js/analysis.js', 'js/advisor.js', 'js/faceshape.js', 'js/face-mesh.js', 'js/makeup.js',
                 'js/makeup-gl.js', 'js/calib.js', 'js/selftest-face.js', 'js/face.js', 'js/app.js'];
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// ── 把 ES 模組併成單一 scope ──────────────────────────────
// 撞名時 JS 只會丟「Identifier has already been declared」這種難查的錯，
// 所以先掃一遍，撞名就中止建置。
const DECL = /^(?:export\s+)?(?:const|let|var|class|function|async\s+function)\s+([A-Za-z_$][\w$]*)/;
// 別名匯入 `import { X as Y }` 在這裡壞得特別安靜：整行 import 被剝掉之後
// Y 就不存在了，而建置階段完全看不出來 —— 只有瀏覽器真的執行到那一行才丟
// ReferenceError。Step 5 的 renderEdit 就是這樣讓整個步驟啞掉的。
//
// 行尾可以帶註解（`import { X } from './a.js';   // 說明`）—— 之前的正規式要求分號後
// 直接換行，帶註解的那一行就沒被剝掉，留在單檔裡變成
// 「Cannot use import statement outside a module」，整個單檔 demo 開機就死。
// 中間用 [^;] 而不是 [\s\S]：比對不能跨過分號，否則一行沒對上時會一路吃到下一個 import。
const IMPORT_LINE = /^import\s+([^;]*?)from\s+['"]\.\/[^'"]+['"];?[ \t]*(?:\/\/[^\n]*)?$/gm;
const ALIAS = /\b([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)/;
const seen = new Map(), clashes = [], aliases = [], parts = [];

for (const file of MODULES) {
  const src = R(file);
  for (const im of src.matchAll(IMPORT_LINE)) {
    const a = im[1].match(ALIAS);
    if (a) aliases.push(`${file}  import { ${a[1]} as ${a[2]} } —— 打包後 ${a[2]} 不存在`);
  }
  for (const line of src.split('\n')) {
    const m = line.match(DECL);
    if (!m) continue;
    if (seen.has(m[1])) clashes.push(`${m[1]}  (${seen.get(m[1])} ↔ ${file})`);
    else seen.set(m[1], file);
  }
  parts.push(`\n/* ═══ ${file} ═══ */\n` + src
    .replace(IMPORT_LINE, '')
    .replace(/^export\s+(const|let|var|class|function|async\s+function)\s/gm, '$1 ')
    .replace(/^export\s+default\s+/gm, '')
    .replace(/^export\s*\{[^}]*\};?[ \t]*$/gm, ''));
}
if (aliases.length) {
  console.error('建置中止：有別名匯入，import 行被剝掉後別名就不存在了\n  ' + aliases.join('\n  '));
  process.exit(1);
}
if (clashes.length) {
  console.error('建置中止：模組間有頂層命名衝突，併成單一 scope 會壞掉\n  ' + clashes.join('\n  '));
  process.exit(1);
}
// 最後一道保險：打包完的程式碼裡不准再有 import / export 陳述式。
// 不管是哪一種寫法漏網，都在建置時擋下來，而不是讓人在機台前看到開機失敗。
const leftovers = [];
parts.join('').split('\n').forEach((line, i) => {
  if (/^\s*(import\s+[\w{*]|export\s)/.test(line)) leftovers.push(`第 ${i + 1} 行：${line.trim().slice(0, 90)}`);
});
if (leftovers.length) {
  console.error('建置中止：打包後仍殘留模組語法，單檔版會在瀏覽器開機時直接失敗\n  ' + leftovers.join('\n  '));
  process.exit(1);
}
console.log(`模組 ${MODULES.length} 個、頂層宣告 ${seen.size} 個，無命名衝突，無殘留 import/export`);

// ── _camtest.html 由 index.html 生成 ─────────────────────
// 之前它是 index.html 的手抄副本，結果 index.html 一改就對不上，
// 測到的是舊畫面 —— 測試頁跟受測頁不同步，比沒有測試頁更糟。
{
  const shim = R('tools/camtest-shim.js');
  const page = R('index.html').replace(
    '<script type="module" src="js/app.js"></script>',
    `<script>
${shim}
</script>
<script type="module" src="js/app.js"></script>`);
  writeFileSync(join(ROOT, '_camtest.html'), page);
  console.log('_camtest.html 由 index.html 生成（假相機測試頁）');
}

// ── 商品照內嵌成 data URI ────────────────────────────────
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const imgDir = join(ROOT, 'images', 'products');
const images = {};
let imgBytes = 0;
if (existsSync(imgDir)) {
  for (const f of readdirSync(imgDir)) {
    const mime = MIME[extname(f).toLowerCase()];
    if (!mime) continue;
    const buf = readFileSync(join(imgDir, f));
    imgBytes += buf.length;
    images[f.replace(/\.[^.]+$/, '')] = `data:${mime};base64,${buf.toString('base64')}`;
  }
}
console.log(`商品照 ${Object.keys(images).length} 張（${KB(imgBytes)}）`);

// ── 推論資源 ─────────────────────────────────────────────
const dataUrl = (path, mime) => `data:${mime};base64,${B(path).toString('base64')}`;
let assetSetup, assetBytes = 0;

if (ONLINE) {
  assetSetup = `
globalThis.__LUCID_VISION__ = ${JSON.stringify(CDN + '/vision_bundle.mjs')};
globalThis.__LUCID_WASM__   = ${JSON.stringify(CDN + '/wasm')};
globalThis.__LUCID_MODEL__  = ${JSON.stringify(MODEL_CDN)};`;
  console.log('推論資源走 CDN（需要網路）');
} else {
  const need = ['vendor/vision_bundle.js', 'vendor/vision_wasm_internal.js',
                'vendor/vision_wasm_internal.wasm', 'models/face_landmarker.task'];
  const missing = need.filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error(`建置中止：離線版需要以下檔案，請先執行 node vendor.mjs\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
  assetBytes = need.reduce((s, f) => s + B(f).length, 0);
  // base64 內嵌，開機時再用 fetch(data:) 轉成 blob URL。
  // 直接把 data: URL 交給 MediaPipe 不保險（它會用 importScripts / fetch
  // 去載這些路徑），blob URL 的行為跟一般網址一致，相容性好得多。
  assetSetup = `
globalThis.__LUCID_READY__ = (async function () {
  var toBlob = async function (d, t) {
    var r = await fetch(d);
    return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: t }));
  };
  globalThis.__LUCID_VISION__ = await toBlob(${JSON.stringify(dataUrl('vendor/vision_bundle.js', 'text/javascript'))}, 'text/javascript');
  globalThis.__LUCID_WASM__ = {
    wasmLoaderPath: await toBlob(${JSON.stringify(dataUrl('vendor/vision_wasm_internal.js', 'text/javascript'))}, 'text/javascript'),
    wasmBinaryPath: await toBlob(${JSON.stringify(dataUrl('vendor/vision_wasm_internal.wasm', 'application/wasm'))}, 'application/wasm'),
  };
  globalThis.__LUCID_MODEL__ = await toBlob(${JSON.stringify(dataUrl('models/face_landmarker.task', 'application/octet-stream'))}, 'application/octet-stream');
})();`;
  console.log(`推論資源內嵌（${MB(assetBytes)} 原始，base64 後約 ${MB(assetBytes * 4 / 3)}）`);
}

// ── 組裝單檔版 ───────────────────────────────────────────
let html = R('index.html');
html = html.replace('<link rel="stylesheet" href="main.css">', `<style>\n${R('main.css')}\n</style>`);

// 傳統腳本而非模組：file:// 是 opaque origin，模組腳本會踩到 CORS 而
// 整段不執行 —— 而且不執行時畫面只會靜靜卡在開機畫面，什麼都不說。
html = html.replace(
  '<script type="module" src="js/app.js"></script>',
  `<script>
// 任何錯誤都要顯示在開機畫面上，不能讓它靜靜卡住
(function () {
  var shown = false;
  function report(what, detail) {
    if (shown) return; shown = true;
    var m = document.getElementById('boot-msg');
    if (!m) return;
    m.style.color = '#ff8a8a'; m.style.maxWidth = '560px'; m.style.lineHeight = '1.7';
    m.textContent = what + '：' + detail;
  }
  addEventListener('error', function (e) {
    report('載入失敗', (e.message || e.error) + (e.lineno ? ' @ line ' + e.lineno : ''));
  });
  addEventListener('unhandledrejection', function (e) {
    report('初始化失敗', (e.reason && (e.reason.message || e.reason)) || '未知錯誤');
  });
  setTimeout(function () {
    var b = document.getElementById('boot');
    if (b && !b.classList.contains('gone')) report('啟動逾時', '60 秒內沒有完成初始化');
  }, 60000);
})();
${assetSetup}
globalThis.__LUCID_IMAGES__ = ${JSON.stringify(images)};
globalThis.__LUCID_SINGLEFILE__ = true;
</script>
<script>
${parts.join('\n')}
</script>`
);

// 放專案根目錄，跟 start.bat 擺在一起 —— 使用者不必翻進 dist/ 找，
// 也不必為了同一份 18 MB 留兩份。
mkdirSync(join(ROOT, 'dist'), { recursive: true });
const out = join(ROOT, 'lucid-demo.html');
writeFileSync(out, html);
console.log(`\n[1] 單檔版　lucid-demo.html　${MB(Buffer.byteLength(html))}`);
console.log(`    雙擊即可開啟${ONLINE ? '（需要網路）' : '（完全離線，不發任何對外請求）'}。`);
console.log('    相機在 file:// 下無法使用（瀏覽器安全規則），只能用上傳照片。');

// ── 靜態託管用的完整站台 ─────────────────────────────────
// 靜態主機沒有伺服器端點，所以 index.json 要產成實體檔案。
const SITE = join(ROOT, 'dist', 'site');
const copy = (rel) => {
  const src = join(ROOT, rel);
  if (!existsSync(src)) return false;
  const dst = join(SITE, rel);
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, readFileSync(src));
  return true;
};
mkdirSync(SITE, { recursive: true });

let n = 0;
const siteFiles = ['index.html', 'main.css', 'models/face_landmarker.task', ...MODULES,
  ...readdirSync(ROOT).filter((x) => /^_.*\.html$/.test(x)),
  ...(existsSync(join(ROOT, 'vendor')) ? readdirSync(join(ROOT, 'vendor')).map((f) => join('vendor', f)) : []),
  ...(existsSync(imgDir) ? readdirSync(imgDir).map((f) => join('images', 'products', f)) : []),
  // 假鏡頭測試頁要用的那張臉 —— 沒複製進來的話，線上版的 _camtest.html 會直接相機錯誤
  'images/_source/face_e1tw71e1tw71e1tw.jpg'];
for (const f of siteFiles) if (copy(f)) n++;
writeFileSync(join(SITE, 'images', 'products', 'index.json'),
              JSON.stringify(Object.keys(images).map((id) => id + '.png')));
n++;

const sizeOf = (d) => readdirSync(d, { withFileTypes: true })
  .reduce((s, e) => s + (e.isDirectory() ? sizeOf(join(d, e.name)) : statSync(join(d, e.name)).size), 0);
console.log(`\n[2] 靜態站台　dist/site/　${n} 個檔案，${MB(sizeOf(SITE))}`);
console.log('    整包丟上任何 HTTPS 靜態空間，或用 start.bat 在本機開 —— 這兩條路相機才能用。');
console.log('    站台同樣不依賴 CDN，離線的內網機台也能跑。');
