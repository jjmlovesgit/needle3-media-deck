import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyManualMetadata, writeJsonAtomic } from './lib.mjs';

const editorDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'editor');
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/editor.js', ['editor.js', 'text/javascript; charset=utf-8']],
  ['/editor.css', ['editor.css', 'text/css; charset=utf-8']]
]);
const revision = text => `"${createHash('sha256').update(text).digest('hex')}"`;
const json = (response, status, value, headers = {}) => {
  const body = JSON.stringify(value); response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...headers }); response.end(body);
};
const requestBody = request => new Promise((resolve, reject) => {
  const chunks = []; let length = 0;
  request.on('data', chunk => { length += chunk.length; if (length > 32768) { reject(new Error('Request body is too large.')); request.destroy(); } else chunks.push(chunk); });
  request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Request body must be valid JSON.')); } });
  request.on('error', reject);
});

export async function startCatalogEditor({ catalogPath, port = 8090 } = {}) {
  const filename = path.resolve(catalogPath || 'catalog.json');
  const initial = JSON.parse(await readFile(filename, 'utf8'));
  if (!Array.isArray(initial.items)) throw new Error('Catalog must contain an items array.');
  let allowedHosts = new Set();
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const origin = request.headers.origin;
    if (!allowedHosts.has(request.headers.host || '') || (origin && !allowedHosts.has(new URL(origin).host)) || request.headers['sec-fetch-site'] === 'cross-site') {
      response.writeHead(403).end('Forbidden'); return;
    }
    try {
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      if (request.method === 'GET' && assets.has(url.pathname)) {
        const [asset, type] = assets.get(url.pathname), body = await readFile(path.join(editorDirectory, asset));
        response.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length }); response.end(body); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/catalog') {
        const raw = await readFile(filename, 'utf8'), catalog = JSON.parse(raw);
        json(response, 200, { filename: path.basename(filename), generatedAt: catalog.generatedAt || null, editedAt: catalog.editedAt || null, items: catalog.items }, { ETag: revision(raw) }); return;
      }
      if (request.method === 'PATCH' && url.pathname.startsWith('/api/items/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/items/'.length));
        const raw = await readFile(filename, 'utf8'), currentRevision = revision(raw);
        if (request.headers['if-match'] !== currentRevision) { json(response, 409, { error: 'The catalog changed on disk. Reload before saving.' }, { ETag: currentRevision }); return; }
        const catalog = JSON.parse(raw), index = catalog.items.findIndex(item => item.id === id);
        if (index < 0) { json(response, 404, { error: 'Catalog item was not found.' }); return; }
        const editedAt = new Date().toISOString(), update = await requestBody(request);
        catalog.items[index] = applyManualMetadata(catalog.items[index], update, editedAt); catalog.editedAt = editedAt;
        await writeJsonAtomic(filename, catalog);
        const saved = await readFile(filename, 'utf8');
        json(response, 200, { item: catalog.items[index], editedAt }, { ETag: revision(saved) }); return;
      }
      response.writeHead(404).end('Not found');
    } catch (error) { json(response, 400, { error: error.message || 'Catalog update failed.' }); }
  });
  server.on('error', error => { if (error.code === 'EADDRINUSE') console.error(`Port ${port} is already in use.`); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const actualPort = server.address().port;
  allowedHosts = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`]);
  console.log(`Media Catalog Editor: http://127.0.0.1:${actualPort}/`);
  console.log(`Catalog: ${filename}`);
  console.log('Press Ctrl+C to stop.');
  return server;
}
