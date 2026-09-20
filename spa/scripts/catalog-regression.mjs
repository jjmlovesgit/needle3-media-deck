import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const appUrl = process.env.MEDIA_DECK_URL || 'http://127.0.0.1:8080/';
const testUrl = new URL(appUrl); testUrl.searchParams.set('catalog-regression', '1');
const reportPath = path.resolve(process.env.CATALOG_REGRESSION_REPORT || '../demo/catalog-regression.json');
const browserCandidates = [process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const browserPath = browserCandidates.find(existsSync);
if (!browserPath) throw new Error('Set BROWSER_PATH to an installed Chromium-family browser.');

const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject); server.listen(0, '127.0.0.1', () => {
    const address = server.address(); server.close(() => resolve(address.port));
  });
});
const profile = await mkdtemp(path.join(os.tmpdir(), 'media-deck-regression-'));
const browser = spawn(browserPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--headless=new', '--disable-gpu', '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', testUrl.href],
  { stdio: 'ignore', windowsHide: true });

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function target() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = pages.find(value => value.type === 'page' && value.url.startsWith(testUrl.href));
      if (page) return page;
    } catch {}
    await wait(100);
  }
  throw new Error('Timed out waiting for the headless browser target.');
}

let socket, nextId = 0;
const pending = new Map();
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

try {
  const page = await target();
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id); pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  };
  await command('Runtime.enable');
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    const state = await command('Runtime.evaluate', { expression: `document.readyState === 'complete' && location.href === ${JSON.stringify(testUrl.href)}`,
      returnByValue: true });
    if (state.result?.value === true) { ready = true; break; }
    await wait(100);
  }
  if (!ready) throw new Error('Timed out waiting for the Media Deck page to finish navigation.');
  const expression = `(${async function (baseUrl) {
    const library = await (await fetch(baseUrl + 'api/library?refresh=1')).json();
    const startedAt = performance.now();
    while (!globalThis.__mediaDeckCatalogRegression && performance.now() - startedAt < 15000) await new Promise(resolve => setTimeout(resolve, 50));
    if (!globalThis.__mediaDeckCatalogRegression) throw new Error('catalog regression hook did not initialize');
    while (globalThis.__mediaDeckCatalogRegression.librarySize() !== library.items.length && performance.now() - startedAt < 15000) await new Promise(resolve => setTimeout(resolve, 50));
    if (globalThis.__mediaDeckCatalogRegression.librarySize() !== library.items.length) throw new Error('application library did not finish indexing');
    const media = document.querySelector('#media'); media.muted = true;
    const counts = { mp3: 0, original_mp4: 0, karaoke_mp4: 0 }, failures = [];
    const waitFor = (event, timeoutMs) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('timeout waiting for ' + event)); }, timeoutMs);
      const success = () => { cleanup(); resolve(); }, failure = () => { cleanup(); reject(new Error(media.error?.message || 'media error')); };
      const cleanup = () => { clearTimeout(timer); media.removeEventListener(event, success); media.removeEventListener('error', failure); };
      media.addEventListener(event, success, { once: true }); media.addEventListener('error', failure, { once: true });
    });
    for (const item of library.items) {
      counts[item.kind] = (counts[item.kind] || 0) + 1;
      const title = item.artist ? item.artist + ' - ' + item.title : item.title;
      const match = globalThis.__mediaDeckCatalogRegression.matchMedia({ title, format: item.kind === 'mp3' ? 'mp3' : 'mp4' });
      if (!match.candidates.some(candidate => candidate.id === item.id)) {
        failures.push({ id: item.id, kind: item.kind, stage: 'match', status: match.status }); continue;
      }
      try {
        media.pause(); media.removeAttribute('src'); media.load();
        media.src = baseUrl + item.url.replace(/^\//, ''); media.load(); await waitFor('loadedmetadata', 12000);
        await media.play();
        const started = performance.now();
        while (media.currentTime <= 0 && !media.ended && performance.now() - started < 8000) await new Promise(resolve => setTimeout(resolve, 50));
        if (media.currentTime <= 0 && !media.ended) throw new Error('playback clock did not advance');
        media.pause();
      } catch (error) { failures.push({ id: item.id, kind: item.kind, stage: 'play', error: error.message }); }
    }
    const needleRoutes = [], expectedTool = 'play_media';
    const spokenFormats = { mp3: 'MP3', mp4: 'MP4' };
    const readyStarted = performance.now();
    while (!document.querySelector('#commandState')?.textContent.includes('WASM READY') && performance.now() - readyStarted < 90000) await new Promise(resolve => setTimeout(resolve, 100));
    if (!document.querySelector('#commandState')?.textContent.includes('WASM READY')) {
      failures.push({ kind: 'all', stage: 'needle', error: 'Needle did not become ready' });
    } else {
      const sensitivity = document.querySelector('#commandSensitivity'); sensitivity.value = '0'; sensitivity.dispatchEvent(new Event('input', { bubbles: true }));
      for (const kind of Object.keys(spokenFormats)) {
        const sample = library.items.filter(item => kind === 'mp3' ? item.kind === 'mp3' : item.kind.endsWith('_mp4'))
          .sort((left, right) => ((left.artist || '') + left.title).length - ((right.artist || '') + right.title).length)[0];
        if (!sample) { failures.push({ kind, stage: 'needle', error: 'No catalog sample' }); continue; }
        const input = document.querySelector('#commandInput'), run = document.querySelector('#commandRun');
        input.value = `Play ${[sample.artist, sample.title].filter(Boolean).join(' ')} ${spokenFormats[kind]}`;
        input.dispatchEvent(new Event('input', { bubbles: true })); run.click();
        const routeStarted = performance.now();
        while (run.disabled && performance.now() - routeStarted < 30000) await new Promise(resolve => setTimeout(resolve, 50));
        const rawCalls = document.querySelector('#validatedCalls')?.textContent || '';
        const tool = /"name"\s*:\s*"([^"]+)"/.exec(rawCalls)?.[1] || '';
        const selectedFormat = /"media_type"\s*:\s*"([^"]+)"/.exec(rawCalls)?.[1] || '';
        const selectedTitle = /"title"\s*:\s*"([^"]+)"/.exec(rawCalls)?.[1] || '';
        const selectedArtist = /"artist"\s*:\s*"([^"]+)"/.exec(rawCalls)?.[1] || '';
        const selectedAlbum = /"album"\s*:\s*"([^"]+)"/.exec(rawCalls)?.[1] || '';
        const expectedFormat = kind;
        const selectedId = media.src ? decodeURIComponent(new URL(media.src).pathname.split('/').pop()) : '';
        const selected = library.items.find(item => item.id === selectedId);
        const result = document.querySelector('#commandResult')?.textContent || '';
        const selectedKindMatches = kind === 'mp3' ? selected?.kind === 'mp3' : selected?.kind?.endsWith('_mp4');
        const pass = tool === expectedTool && selectedFormat === expectedFormat && selectedKindMatches && result.startsWith('Playback requested:');
        needleRoutes.push({ kind, expectedTool, expectedFormat, selectedTool: tool, selectedFormat, selectedTitle, selectedArtist, selectedAlbum, selectedKind: selected?.kind || null, pass });
        if (!pass) failures.push({ id: sample.id, kind, stage: 'needle', expectedTool, expectedFormat, selectedTool: tool, selectedFormat, selectedTitle, selectedArtist, selectedAlbum, selectedKind: selected?.kind || null, result });
      }
    }
    media.pause(); media.removeAttribute('src'); media.load();
    return { generatedAt: new Date().toISOString(), files: library.items.length, counts,
      matched: library.items.length - failures.filter(value => value.stage === 'match').length,
      played: library.items.length - failures.filter(value => value.stage === 'play').length,
      needleRoutes, failures };
  }.toString()})(${JSON.stringify(appUrl)})`;
  const evaluated = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.text);
  const report = evaluated.result.value;
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ report: reportPath, ...report }, null, 2));
  if (report.failures.length) process.exitCode = 1;
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  browser.kill();
  await new Promise(resolve => browser.once('exit', resolve));
  await rm(profile, { recursive: true, force: true });
}
