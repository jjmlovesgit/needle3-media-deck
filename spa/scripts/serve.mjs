import { verifyNeedleAssets } from './verify-needle.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MediaSource, byteRange, within } from './media-source.mjs';
await verifyNeedleAssets();
const root = path.resolve(import.meta.dirname, '../app');
const configUrl = new URL('../config/media-sources.json', import.meta.url);
const config = JSON.parse(await readFile(configUrl, 'utf8'));
const configuredSource = config.sources[0];
const media = new MediaSource({ ...configuredSource,
  path: path.resolve(path.dirname(fileURLToPath(configUrl)), configuredSource.path) });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Restrict loopback host and browser origin; no cross-origin library access.
  if (!['127.0.0.1:8080', 'localhost:8080'].includes(req.headers.host) ||
      (req.headers.origin && !['http://127.0.0.1:8080', 'http://localhost:8080'].includes(req.headers.origin)) ||
      req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403).end(); return; }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  try {
    const url = new URL(req.url, 'http://localhost');
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
}).listen(8080, '127.0.0.1', () => console.log('Media Deck: http://127.0.0.1:8080'));
