#!/usr/bin/env node
/**
 * Run a frozen Media Deck JSONL split through the currently served SPA.
 * Does not start, stop, or modify the user's server.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (!process.argv[index]?.startsWith('--')) throw new Error('Expected --option value pairs.');
  args.set(process.argv[index].slice(2), process.argv[index + 1]);
}
const appUrl = args.get('url') || process.env.MEDIA_DECK_URL || 'http://127.0.0.1:8080/';
const splitPath = path.resolve(args.get('data') || path.join(root, 'demo', 'needle-training-data', 'test.jsonl'));
const label = args.get('label') || 'baseline';
const modelAsset = args.get('model');
const outputPath = path.resolve(args.get('out') || path.join(root, 'demo', 'needle-benchmarks', label + '.json'));
const browserPath = [process.env.BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(value => value && existsSync(value));
if (!browserPath) throw new Error('Set BROWSER_PATH to an installed Chromium-family browser.');

const rows = (await readFile(splitPath, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line))
  .map(value => ({ query: value.query, expected: value.answers }));
if (!rows.length) throw new Error('The benchmark split contains no rows.');

const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});
const profile = await mkdtemp(path.join(os.tmpdir(), 'media-deck-benchmark-'));
const targetUrl = new URL(appUrl);
targetUrl.searchParams.set('needle-benchmark', label);
if (modelAsset) targetUrl.searchParams.set('needle-model', modelAsset);
const browser = spawn(browserPath, [
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile,
  '--headless=new',
  '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  targetUrl.href
], { stdio: 'ignore', windowsHide: true });

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function target() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      const page = pages.find(value => value.type === 'page' && value.url.startsWith(targetUrl.href));
      if (page) return page;
    } catch {}
    await wait(100);
  }
  throw new Error('Timed out waiting for the benchmark browser.');
}

let socket;
let nextId = 0;
const pending = new Map();
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
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
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  };
  await command('Runtime.enable');
  let pageReady = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    const state = await command('Runtime.evaluate', {
      expression: 'document.readyState === "complete" && location.href === ' + JSON.stringify(targetUrl.href),
      returnByValue: true
    });
    if (state.result?.value) { pageReady = true; break; }
    await wait(100);
  }
  if (!pageReady) throw new Error('Timed out waiting for Media Deck navigation to settle.');
  const expression = `(${async function (benchmarkRows) {
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const started = performance.now();
    while (!document.querySelector('#commandInput') && performance.now() - started < 15000) await wait(50);
    const input = document.querySelector('#commandInput');
    const run = document.querySelector('#commandRun');
    const sensitivity = document.querySelector('#commandSensitivity');
    const media = document.querySelector('#media');
    if (!input || !run || !sensitivity || !media) throw new Error('Media Deck command controls did not mount.');
    const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    const parseCalls = text => {
      const json = text.replace(/^(?:PROPOSED BY NEEDLE|VALIDATED BY APPLICATION|AWAITING CONFIRMATION)\\n/, '').trim();
      if (!json) return [];
      try { return JSON.parse(json); } catch { return null; }
    };
    const routeMs = text => Number(/\broute (\d+) ms\b/.exec(text)?.[1]) || null;
    sensitivity.value = '0';
    sensitivity.dispatchEvent(new Event('input', { bubbles: true }));
    media.muted = true;
    const readyStarted = performance.now();
    while (!document.querySelector('#commandState').textContent.includes('WASM READY') && performance.now() - readyStarted < 90000) await wait(100);
    if (!document.querySelector('#commandState').textContent.includes('WASM READY')) throw new Error('Needle did not become ready.');
    const results = [];
    for (let index = 0; index < benchmarkRows.length; index++) {
      const fixture = benchmarkRows[index];
      input.value = fixture.query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      run.click();
      const startedRoute = performance.now();
      while (run.disabled && performance.now() - startedRoute < 45000) await wait(25);
      if (run.disabled) throw new Error('Timed out routing benchmark row ' + index);
      const state = document.querySelector('#commandState').textContent;
      const result = document.querySelector('#commandResult').textContent;
      const callText = document.querySelector('#validatedCalls')?.textContent || '';
      const actual = parseCalls(callText);
      const exact = actual !== null && same(actual, fixture.expected);
      const expectedNoAction = fixture.expected.length === 0;
      const validatorPassed = expectedNoAction ? state.includes('NO ACTION') : !state.includes('CHECK RESULT') && actual !== null;
      const executionPassed = expectedNoAction ? state.includes('NO ACTION') : state.includes('LOCAL RESULT');
      results.push({
        index,
        query: fixture.query,
        expected: fixture.expected,
        actual,
        exact,
        validatorPassed,
        executionPassed,
        state,
        result,
        routeMs: routeMs(document.querySelector('#routingMetrics')?.textContent || '')
      });
    }
    const metric = selector => document.querySelector(selector)?.textContent || '';
    return {
      model: metric('#routingMetrics'),
      rows: results,
      pageMetrics: {
        wasmMemoryBytes: performance.memory?.usedJSHeapSize || null,
        mediaCurrentSrc: media.currentSrc || null
      }
    };
  }.toString()})(${JSON.stringify(rows)})`;
  const evaluated = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.text);
  const outcome = evaluated.result.value;
  const summarize = predicate => outcome.rows.filter(predicate).length;
  const report = {
    generatedAt: new Date().toISOString(),
    label,
    appUrl,
    split: path.relative(root, splitPath),
    model: outcome.model,
    modelAsset: modelAsset || 'needle3.cact',
    summary: {
      rows: outcome.rows.length,
      exactCalls: summarize(value => value.exact),
      validatorPassed: summarize(value => value.validatorPassed),
      executionPassed: summarize(value => value.executionPassed),
      noActionRows: summarize(value => value.expected.length === 0),
      noActionExact: summarize(value => value.expected.length === 0 && value.exact),
      namedPlaybackRows: summarize(value => value.expected.some(call => call.name === 'play_media')),
      namedPlaybackExact: summarize(value => value.expected.some(call => call.name === 'play_media') && value.exact),
      routeMs: {
        count: summarize(value => Number.isFinite(value.routeMs)),
        mean: (() => { const values = outcome.rows.map(value => value.routeMs).filter(Number.isFinite); return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null; })()
      }
    },
    failures: outcome.rows.filter(value => !value.exact || !value.validatorPassed || !value.executionPassed),
    rows: outcome.rows,
    pageMetrics: outcome.pageMetrics
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ report: outputPath, model: report.model, summary: report.summary, failures: report.failures.length }, null, 2));
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  browser.kill();
  await new Promise(resolve => browser.once('exit', resolve));
  await rm(profile, { recursive: true, force: true });
}
