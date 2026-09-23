import { verifyNeedleAssets } from './verify-needle.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MediaSource, byteRange, within } from './media-source.mjs';
import { createCatalogItemApi } from '../../utilities/media-catalog/editor-server.mjs';
import { WakewordBridge } from './wakeword-bridge.mjs';

const parsePort = value => {
  const port = Number(value ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MEDIA_DECK_PORT must be an integer from 1 to 65535.');
  return port;
};

await verifyNeedleAssets();
const port = parsePort(process.env.MEDIA_DECK_PORT);
const root = path.resolve(import.meta.dirname, '../app');
const configUrl = new URL('../config/media-sources.json', import.meta.url);
const config = JSON.parse(await readFile(configUrl, 'utf8'));
const configuredSource = config.sources[0];
const configuredPath = process.env.MEDIA_DECK_LIBRARY?.trim()
  ? path.resolve(process.env.MEDIA_DECK_LIBRARY.trim())
  : path.resolve(path.dirname(fileURLToPath(configUrl)), configuredSource.path);
const media = new MediaSource({ ...configuredSource, path: configuredPath });
const catalogItemApi = createCatalogItemApi(path.join(media.source.path, 'catalog.json'));
const projectRoot = path.resolve(import.meta.dirname, '../..');
const spaRoot = path.resolve(import.meta.dirname, '..');
const wakeword = new WakewordBridge({
  pythonPath: process.env.MEDIA_DECK_PYTHON?.trim() || path.join(projectRoot, '.venv', 'Scripts', 'python.exe'),
  servicePath: path.join(import.meta.dirname, 'wakeword-service.py'),
  modelPath: path.join(spaRoot, 'wakeword', 'models', 'hey_jarvis_v0.1.onnx')
});
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const contentSecurityPolicy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

const appServer = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', contentSecurityPolicy);
  // Restrict loopback host and browser origin; no cross-origin library access.
  const origin = req.headers.origin;
  let originAllowed = true;
  try { if (origin) originAllowed = allowedHosts.has(new URL(origin).host); } catch { originAllowed = false; }
  if (!allowedHosts.has(req.headers.host || '') || !originAllowed || req.headers['sec-fetch-site'] === 'cross-site') {
    res.writeHead(403).end(); return;
  }
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith('/api/wakeword/')) {
      const action = url.pathname.slice('/api/wakeword/'.length);
      if (req.method === 'GET' && action === 'status') {
        const state = await wakeword.status();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state)); return;
      }
      if (req.method === 'POST' && ['config', 'pause', 'resume'].includes(action)) {
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 4096) throw new Error('Wake-word request is too large.'); }
        let data = {};
        try { data = body ? JSON.parse(body) : {}; } catch { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({error:'Wake-word request must be JSON.'})); return; }
        const state = action === 'config' ? await wakeword.configure(data.enabled) : await wakeword[action]();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state)); return;
      }
      res.writeHead(405, { Allow:'GET, POST' }).end(); return;
    }    if (url.pathname.startsWith('/api/catalog/items/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/catalog/items/'.length));
      await catalogItemApi(req, res, id); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    if (url.pathname === '/api/library') {
      try {
        const manifest = await media.scan(url.searchParams.get('refresh') === '1');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify(manifest));
      } catch {
        res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'The configured media folder is unavailable. Check the source path and access.' }));
      }
      return;
    }
    if (url.pathname.startsWith('/media/')) {
      const opened = await media.openMedia(url.pathname.slice(7));
      if (!opened) { res.writeHead(404).end(); return; }
      const range = byteRange(req.headers.range, opened.size);
      if (!range) { await opened.handle.close(); res.writeHead(416, { 'Content-Range': 'bytes */' + opened.size }).end(); return; }
      const headers = { 'Content-Type': opened.mime, 'Accept-Ranges': 'bytes', 'Content-Length': range.end - range.start + 1 };
      if (range.partial) headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + opened.size;
      res.writeHead(range.partial ? 206 : 200, headers);
      if (req.method === 'HEAD') { await opened.handle.close(); res.end(); return; }
      const stream = opened.handle.createReadStream({ start: range.start, end: range.end, autoClose: true });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
      return;
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!within(root, file)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { if (!res.headersSent) res.writeHead(404).end('Not found'); else res.destroy(); }
});

const shutdown = () => { wakeword.stop(); appServer.close(() => process.exit(0)); };
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
if (process.env.MEDIA_DECK_LAUNCHER === '1') {
  process.stdin.resume();
  process.stdin.once('end', shutdown);
}

appServer.listen(port, '127.0.0.1', () => {
  console.log(`Media Deck: http://127.0.0.1:${port}`);
});
