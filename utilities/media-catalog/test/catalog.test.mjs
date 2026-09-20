import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyDecision, decideCandidate, enrichCatalog, inferLocalMetadata, musicBrainzQuery, MusicBrainzClient, rankMusicBrainzCandidates, scanLibrary } from '../lib.mjs';

test('local inference produces uniform metadata without media-specific rules', () => {
  assert.deepEqual(inferLocalMetadata('Example Artist - Example Track Alpha_20260917_114941_token/source.mp4'),
    { title: 'Example Track Alpha', artist: 'Example Artist', album: '', track: null });
  assert.deepEqual(inferLocalMetadata('Example Album - Tracks/02 - Example Track Beta.mp3'),
    { title: 'Example Track Beta', artist: '', album: 'Example Album', track: 2 });
});

test('scanner reads supported files and never alters them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metadata-catalog-'));
  await mkdir(path.join(root, 'Example Album - Tracks'));
  const media = path.join(root, 'Example Album - Tracks', '01 - Example Track.mp3');
  await writeFile(media, 'unchanged'); await writeFile(path.join(root, 'ignore.txt'), 'ignore');
  const catalog = await scanLibrary(root);
  assert.equal(catalog.items.length, 1); assert.equal(catalog.items[0].title, 'Example Track');
  assert.equal(await readFile(media, 'utf8'), 'unchanged');
});

const local = { title: 'Example Track Alpha', artist: 'Example Artist', album: '', track: null };
const recordings = [
  { id: 'recording-a', title: 'Example Track Alpha', score: 100, length: 201000,
    'artist-credit': [{ name: 'Example Artist' }], releases: [{ title: 'Example Album', date: '2020-01-02' }] },
  { id: 'recording-b', title: 'Example Track Alpha Remix', score: 86,
    'artist-credit': [{ name: 'Different Artist' }], releases: [] }
];

test('candidate acceptance requires title, artist, provider score, and separation', () => {
  const ranked = rankMusicBrainzCandidates(local, recordings), decision = decideCandidate(local, ranked);
  assert.equal(decision.status, 'accepted');
  const item = applyDecision({ ...local, aliases: [], provenance: {} }, decision, ranked);
  assert.equal(item.musicBrainzRecordingId, 'recording-a'); assert.equal(item.album, 'Example Album'); assert.equal(item.year, 2020);
});

test('title-only evidence stays reviewable and query escaping is bounded', () => {
  const titleOnly = { title: 'Example Track Alpha', artist: '' }, ranked = rankMusicBrainzCandidates(titleOnly, recordings);
  assert.equal(decideCandidate(titleOnly, ranked).status, 'review');
  assert.equal(musicBrainzQuery({ title: 'Example "Quoted" Track', artist: 'Example Artist' }),
    'recording:"Example \\"Quoted\\" Track" AND artist:"Example Artist"');
});

test('client caches responses and enrichment stays standalone', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metadata-cache-')); let requests = 0;
  const fetchImpl = async (_url, options) => { requests++; assert.match(options.headers['User-Agent'], /^Needle3MediaCatalog\/0\.1/);
    return { ok: true, status: 200, json: async () => ({ recordings }) }; };
  const client = new MusicBrainzClient({ cacheDirectory: root, contact: 'https://example.invalid/contact', fetchImpl, intervalMs: 0 });
  const item = { id: 'one', ...local, local, aliases: [], provenance: {} };
  const first = await enrichCatalog({ schemaVersion: 1, items: [item] }, client);
  const second = await enrichCatalog({ schemaVersion: 1, items: [item] }, client);
  assert.equal(first.items[0].status, 'accepted'); assert.equal(second.items[0].status, 'accepted'); assert.equal(requests, 1);
});
