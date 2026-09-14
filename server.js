/**
 * 零依賴靜態伺服器。
 * 相機 API 需要 secure context — localhost 算安全來源，所以本機直接跑即可。
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 5173;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.task': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.png':  'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  // 開發用：_slice.html 把切好去背的 PNG 存回 images/products/
  // 只接受安全檔名，且只能寫進這一個資料夾。正式部署請移除。
  if (req.method === 'POST' && url.startsWith('/api/save/')) {
    const name = url.slice('/api/save/'.length);
    if (!/^[A-Za-z0-9_-]{1,40}\.png$/.test(name)) {
      res.writeHead(400).end('bad name');
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      fs.writeFile(path.join(ROOT, 'images', 'products', name), Buffer.concat(chunks), (err) => {
        res.writeHead(err ? 500 : 200, { 'content-type': 'text/plain' })
           .end(err ? String(err) : 'ok');
      });
    });
    return;
  }

  // 商品照索引：一次問完有哪些圖，前端就不必逐一試副檔名打出一堆 404
  if (url === '/images/products/index.json') {
    fs.readdir(path.join(ROOT, 'images', 'products'), (err, files) => {
      const imgs = (files || []).filter((f) => /\.(png|webp|jpe?g)$/i.test(f));
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' })
         .end(JSON.stringify(imgs));
    });
    return;
  }

  let file = path.join(ROOT, url === '/' ? 'index.html' : url);

  if (!path.resolve(file).startsWith(path.resolve(ROOT))) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404 ' + url); return; }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    }).end(buf);
  });
}).listen(PORT, () => console.log(`LUCID demo running at http://localhost:${PORT}`));
