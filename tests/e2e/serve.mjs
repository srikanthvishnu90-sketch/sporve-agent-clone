// tests/e2e/serve.mjs — serve the built page from a real http origin.
// Chromium treats file:// as an opaque origin for storage on some builds (CI
// lost localStorage across a reload), so anything that must SURVIVE a reload
// is proven over http://127.0.0.1, the way production (https) behaves.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
const ROOT = new URL('../../', import.meta.url);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
export async function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = (path === '/' ? '/index.html' : path).replace(/^\/+/, '');
    if (rel.includes('..')) { res.writeHead(403); return res.end(); }
    try { const body = await readFile(new URL(rel, ROOT)); res.writeHead(200, { 'content-type': TYPES[extname(rel)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, index: base + '/index.html', close: () => new Promise((r) => server.close(r)) };
}
