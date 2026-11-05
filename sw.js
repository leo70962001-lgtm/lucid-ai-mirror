/**
 * Service worker：讓網頁可以「安裝成 App」，而且離線也能開。
 *
 * 建置（node build.mjs）會把這份複製到 dist/site/，並把 VERSION 換成所有檔案內容的雜湊、
 * SHELL 換成實際要預先存的清單。原始碼這份 VERSION 是 'dev'：開發時什麼都不存，
 * 改了程式重新整理就看得到（不會被快取卡住），但仍然註冊得起來，安裝流程在本機也測得到。
 *
 * 存法：
 *   程式與頁面（html / js / css / manifest）→ 先上網拿最新的，沒網路才用存起來的。
 *     改版後一定拿到新程式，不會出現「新的 html 配舊的 js」。
 *   大型檔（模型、WASM、商品照、圖示）→ 先用存起來的，沒有才下載並存起來。
 *     第一次開機載入過，之後就算沒網路也開得起來。
 */
const VERSION = 'dc74b2cb9a05';
const SHELL = ["./","index.html","main.css","js/i18n.js","js/products.js","js/context.js","js/analysis.js","js/season.js","js/lipcolor.js","js/trends.js","js/coach.js","js/routine.js","js/skincond.js","js/duel.js","js/fit.js","js/live.js","js/pwa.js","js/learn.js","js/qa.js","js/advisor.js","js/emoji.js","js/gender.js","js/chart.js","js/faceshape.js","js/face-mesh.js","js/makeup.js","js/makeup-gl.js","js/calib.js","js/selftest-face.js","js/face.js","js/app.js","images/products/C01.png","images/products/C02.png","images/products/C03.png","images/products/E01.png","images/products/E02.png","images/products/E03.png","images/products/L118.png","images/products/L204.png","images/products/L307.png","images/products/L455.png","images/products/L512.png","images/products/L620.png","images/products/README.md","manifest.webmanifest","icons/apple-touch-icon.png","icons/favicon-32.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","images/products/index.json"];
const CACHE = 'lucid-' + VERSION;
const BIG = /\/(vendor|models|images|icons)\//;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  if (VERSION === 'dev') return;
  // 一個一個存：某個檔案拿不到（例如網路斷一下）不會讓整個安裝失敗
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('lucid-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') c.put(req, res.clone());
    return res;
  } catch {
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return (await c.match('index.html')) || Response.error();
    return Response.error();
  }
}
async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') c.put(req, res.clone());
  return res;
}

// 頁面開機完成後送來的清單：模型、WASM 已經載過了，補存一份，下次沒網路也開得起來
self.addEventListener('message', (e) => {
  if (VERSION === 'dev' || e.data?.type !== 'warm' || !Array.isArray(e.data.urls)) return;
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(e.data.urls
    .filter((u) => { try { return new URL(u).origin === self.location.origin && BIG.test(new URL(u).pathname); } catch { return false; } })
    .map(async (u) => { if (!(await c.match(u, { ignoreSearch: true }))) await c.add(u).catch(() => null); }))));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (VERSION === 'dev' || req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.has('range')) return;          // 影片分段讀取交給瀏覽器
  e.respondWith(BIG.test(url.pathname) ? cacheFirst(req) : networkFirst(req));
});
