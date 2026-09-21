import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyManualMetadata, applyMatchDecision, applyRecordingMetadata, classifyCatalogMedia, decideCandidate, enrichCatalog, inferLocalMetadata, markEnrichmentEligibility, matchCatalog, musicBrainzQuery, MusicBrainzClient, prepareLookupMetadata, probeDurationMs, rankMusicBrainzCandidates, safePathSegment, scanLibrary, stageCatalog, stagedRelativePath, validateManualMetadata, writeJsonAtomic } from '../lib.mjs';
import { startCatalogEditor } from '../editor-server.mjs';

test('local inference produces uniform metadata without media-specific rules', () => {
  assert.deepEqual(inferLocalMetadata('Example Artist - Example Track Alpha_20260917_114941_token/source.mp4'),
    { title: 'Example Track Alpha', artist: 'Example Artist', album: '', track: null });
  assert.deepEqual(inferLocalMetadata('Example Album - Tracks/02 - Example Track Beta.mp3'),
    { title: 'Example Track Beta', artist: '', album: 'Example Album', track: 2 });
});

test('catalog media classification preserves MP3, original MP4, and karaoke MP4 kinds', () => {
  assert.equal(classifyCatalogMedia('Example Artist/Example Track.mp3'), 'mp3');
  assert.equal(classifyCatalogMedia('Example Artist/source.mp4'), 'original_mp4');
  assert.equal(classifyCatalogMedia('Example Artist/karaoke.mp4'), 'karaoke_mp4');
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

test('album media is excluded while its individual songs remain eligible', () => {
  const items = markEnrichmentEligibility([
    { id: 'album', title: 'Example Collection Full Album', album: '', track: null, relativePath: 'Example Collection/source.mp4' },
    { id: 'track', title: 'Example Song', album: 'Example Collection', track: 1, relativePath: 'Example Collection - Tracks/01 - Example Song.mp3' },
    { id: 'single', title: 'Standalone Song', album: '', track: null, relativePath: 'Standalone Song/source.mp4' }
  ]);
  assert.equal(items[0].eligibleForEnrichment, false);
  assert.equal(items[0].status, 'excluded-album');
  assert.equal(items[1].eligibleForEnrichment, true);
  assert.equal(items[2].eligibleForEnrichment, true);
});

test('media over ten minutes is excluded before matching', () => {
  const items = markEnrichmentEligibility([
    { id: 'short', title: 'Short Song', album: '', track: null, relativePath: 'short.mp3', durationMs: 600000, status: 'local' },
    { id: 'long', title: 'Long Recording', album: '', track: null, relativePath: 'long.mp3', durationMs: 600001, status: 'local' },
    { id: 'unknown', title: 'Unknown Duration', album: '', track: null, relativePath: 'unknown.mp3', durationMs: null, status: 'local' }
  ]);
  assert.equal(items[0].eligibleForEnrichment, true);
  assert.equal(items[1].eligibleForEnrichment, false); assert.equal(items[1].status, 'excluded-long-form');
  assert.equal(items[2].eligibleForEnrichment, true);
});

test('duration probe converts seconds to milliseconds and tolerates unavailable probes', async () => {
  assert.equal(await probeDurationMs('example.mp3', async () => ({ stdout: '123.456\n' })), 123456);
  assert.equal(await probeDurationMs('example.mp3', async () => { throw new Error('missing'); }), null);
});

const local = { title: 'Example Track Alpha', artist: 'Example Artist', album: '', track: null };
const recordings = [
  { id: '00000000-0000-4000-8000-000000000001', title: 'Example Track Alpha', score: 100, length: 201000,
    'artist-credit': [{ name: 'Example Artist' }], releases: [{ title: 'Example Album', date: '2020-01-02' }] },
  { id: '00000000-0000-4000-8000-000000000003', title: 'Example Track Alpha', score: 99, length: 202000,
    'artist-credit': [{ name: 'Example Artist' }], releases: [{ title: 'Another Release', date: '2021' }] },
  { id: '00000000-0000-4000-8000-000000000002', title: 'Example Track Alpha Remix', score: 86,
    'artist-credit': [{ name: 'Different Artist' }], releases: [] }
];

test('matching stores only identity evidence before metadata lookup', () => {
  const ranked = rankMusicBrainzCandidates(local, recordings), decision = decideCandidate(local, ranked);
  assert.equal(decision.status, 'accepted');
  const item = applyMatchDecision({ ...local, aliases: [], provenance: {} }, decision, ranked);
  assert.equal(item.status, 'matched');
  assert.equal(item.matchedRecordingId, '00000000-0000-4000-8000-000000000001');
  assert.equal(item.musicBrainzRecordingId, undefined); assert.equal(item.year, undefined);
  assert.deepEqual(Object.keys(item.candidates[0]).sort(), ['artist','musicBrainzRecordingId','score','title']);
  const enriched = applyRecordingMetadata(item, recordings[0]);
  assert.equal(enriched.status, 'enriched'); assert.equal(enriched.album, 'Example Album'); assert.equal(enriched.year, 2020);
});

test('metadata lookup preserves a locally probed duration when the provider omits it', () => {
  const item = { ...local, durationMs: 198000, aliases: [], provenance: { durationMs: 'local-probe' } };
  const recording = { ...recordings[0], length: null };
  const enriched = applyRecordingMetadata(item, recording);
  assert.equal(enriched.durationMs, 198000); assert.equal(enriched.provenance.durationMs, 'local-probe');
});

test('manual song metadata is validated and protected from later enrichment', () => {
  const item = { id: 'one', relativePath: 'Example.mp4', extension: 'mp4', kind: 'original_mp4', ...local,
    track: null, year: null, aliases: [], provenance: {} };
  const input = { title: 'Reviewed Title', artist: 'Reviewed Artist', album: '', track: 2, year: 2024,
    aliases: ['Voice Name', 'voice name', 'Reviewed Title', ''], kind: 'karaoke_mp4' };
  const reviewed = applyManualMetadata(item, input, '2026-09-20T12:00:00.000Z');
  assert.equal(reviewed.title, 'Reviewed Title'); assert.equal(reviewed.kind, 'karaoke_mp4');
  assert.deepEqual(reviewed.aliases, ['Voice Name']); assert(reviewed.manualFields.includes('title'));
  const enriched = applyRecordingMetadata(reviewed, recordings[0]);
  assert.equal(enriched.title, 'Reviewed Title'); assert.equal(enriched.artist, 'Reviewed Artist');
  assert.equal(enriched.year, 2024); assert.equal(enriched.provenance.title, 'manual');
});

test('manual metadata rejects missing titles, invalid ranges, unknown fields, and format changes', () => {
  const item = { relativePath: 'Example.mp3', extension: 'mp3', kind: 'mp3' };
  const valid = { title: 'Example', artist: '', album: '', track: null, year: null, aliases: [], kind: 'mp3' };
  assert.equal(validateManualMetadata(item, valid).title, 'Example');
  assert.throws(() => validateManualMetadata(item, { ...valid, title: '' }), /required/);
  assert.throws(() => validateManualMetadata(item, { ...valid, year: 999 }), /Year/);
  assert.throws(() => validateManualMetadata(item, { ...valid, kind: 'original_mp4' }), /inconsistent/);
  assert.throws(() => validateManualMetadata(item, { ...valid, extra: true }), /every editable/);
});

test('atomic catalog writes replace complete JSON without leaving temporary files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metadata-editor-')), filename = path.join(root, 'catalog.json');
  await writeFile(filename, '{"old":true}\n'); await writeJsonAtomic(filename, { schemaVersion: 1, items: [] });
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), { schemaVersion: 1, items: [] });
  assert.deepEqual((await (await import('node:fs/promises')).readdir(root)).sort(), ['catalog.json']);
});

test('local editor saves one item and rejects a stale browser revision', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metadata-editor-server-')), filename = path.join(root, 'catalog.json');
  const item = { id: 'example-id', relativePath: 'Example.mp3', extension: 'mp3', kind: 'mp3', title: 'Example',
    artist: '', album: '', track: null, year: null, aliases: [], durationMs: 120000 };
  await writeFile(filename, JSON.stringify({ schemaVersion: 1, items: [item] }));
  const server = await startCatalogEditor({ catalogPath: filename, port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`, loaded = await fetch(base + '/api/catalog');
    const etag = loaded.headers.get('etag'); assert.equal((await loaded.json()).items[0].title, 'Example');
    const individual = await fetch(base + '/api/items/example-id');
    assert.equal((await individual.json()).item.relativePath, 'Example.mp3'); assert.equal(individual.headers.get('etag'), etag);
    const body = { title: 'Reviewed Example', artist: 'Example Artist', album: '', track: null, year: null, aliases: ['Spoken Example'], kind: 'mp3' };
    const saved = await fetch(base + '/api/items/example-id', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': etag }, body: JSON.stringify(body) });
    assert.equal(saved.status, 200); assert.equal((await saved.json()).item.title, 'Reviewed Example');
    const stale = await fetch(base + '/api/items/example-id', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': etag }, body: JSON.stringify(body) });
    assert.equal(stale.status, 409);
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).items[0].artist, 'Example Artist');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('duplicate recording IDs for the same title and artist do not create false ambiguity', () => {
  const ranked = rankMusicBrainzCandidates(local, recordings), decision = decideCandidate(local, ranked);
  assert.equal(decision.status, 'accepted');
  assert(decision.margin > .05);
});

test('title-only evidence stays reviewable and query escaping is bounded', () => {
  const titleOnly = { title: 'Example Track Alpha', artist: '' }, ranked = rankMusicBrainzCandidates(titleOnly, recordings);
  assert.equal(decideCandidate(titleOnly, ranked).status, 'review');
  assert.equal(musicBrainzQuery({ title: 'Example "Quoted" Track', artist: 'Example Artist' }),
    'recording:"Example \\"Quoted\\" Track" AND artist:"Example Artist"');
});

test('artist-required matching never sends title-only records', async () => {
  let searches = 0;
  const client = { search: async () => { searches++; return { recordings: [] }; } };
  const result = await matchCatalog({ items: [
    { id: 'artist', title: 'Example One', artist: 'Example Artist', album: '', relativePath: 'one.mp3', status: 'local', eligibleForEnrichment: true },
    { id: 'title', title: 'Example Two', artist: '', album: '', relativePath: 'two.mp3', status: 'local', eligibleForEnrichment: true }
  ] }, client, Infinity, { requireArtist: true });
  assert.equal(searches, 1);
  assert.equal(result.items.find(item => item.id === 'title').status, 'skipped-no-artist');
});

test('lookup preparation removes generic promotional suffixes and derives collection artist', () => {
  assert.deepEqual(prepareLookupMetadata({ local: { title: 'Example Track Official Video', artist: '', album: '3 Hours of Example Artist for Evening Listening', track: 1 } }),
    { title: 'Example Track', artist: 'Example Artist', album: '3 Hours of Example Artist for Evening Listening', track: 1 });
  assert.equal(musicBrainzQuery({ local: { title: 'Example Track Official Video', artist: 'Example Artist' } }),
    'recording:"Example Track" AND artist:"Example Artist"');
  assert.equal(prepareLookupMetadata({ local: { title: 'Music Video - Example Track 1999 HQ', artist: '', album: '' } }).title, 'Example Track');
  assert.equal(prepareLookupMetadata({ local: { title: 'Example Track Official Music Video HD - Karaoke', artist: '', album: '' } }).title, 'Example Track');
  assert.equal(prepareLookupMetadata({ local: { title: 'Example Track - Live at Example Hall Official Pro Shot', artist: '', album: '' } }).title, 'Example Track');
  assert.equal(prepareLookupMetadata({ local: { title: 'Example Track Official Lyric Video', artist: '', album: '' } }).title, 'Example Track');
});

test('repeated words do not score as an exact title match', () => {
  const ranked = rankMusicBrainzCandidates({ title: 'Example', artist: '' }, [
    { id: 'repeated', title: 'Example Example Example', score: 100, 'artist-credit': [] }
  ]);
  assert(ranked[0].titleSimilarity < .6);
});

test('match and metadata phases use separate requests and caches', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metadata-cache-')); let requests = 0;
  const fetchImpl = async (url, options) => { requests++; assert.match(options.headers['User-Agent'], /^Needle3MediaCatalog\/0\.1/);
    const isLookup=!url.searchParams.has('query');
    return { ok: true, status: 200, json: async () => isLookup ? recordings[0] : ({ recordings }) }; };
  const client = new MusicBrainzClient({ cacheDirectory: root, contact: 'https://example.invalid/contact', fetchImpl, intervalMs: 0 });
  const item = { id: 'one', ...local, local, aliases: [], provenance: {} };
  const matches = await matchCatalog({ schemaVersion: 1, items: [item] }, client);
  assert.equal(matches.items[0].status, 'matched'); assert.equal(requests, 1);
  const searchCache = await readFile(path.join(root, (await import('node:crypto')).createHash('sha256').update(musicBrainzQuery(item)).digest('hex') + '.json'), 'utf8');
  assert.doesNotMatch(searchCache, /"length"|"releases"/);
  const first = await enrichCatalog(matches, client), second = await enrichCatalog(matches, client);
  assert.equal(first.items[0].status, 'enriched'); assert.equal(second.items[0].status, 'enriched'); assert.equal(requests, 2);
});

test('staging copies only enriched songs with portable uniform names and a manifest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metadata-stage-source-'));
  const destination = await mkdtemp(path.join(os.tmpdir(), 'metadata-stage-parent-')).then(parent => path.join(parent, 'demo'));
  await writeFile(path.join(root, 'first.mp3'), 'first-source'); await writeFile(path.join(root, 'second.mp4'), 'second-source');
  const enriched = { id: '0123456789abcdef'.repeat(4), relativePath: 'first.mp3', extension: 'mp3', status: 'enriched',
    title: 'Example: Track?', artist: 'Example/Artist', album: 'Example Album', track: 1, year: 2020,
    durationMs: 123000, musicBrainzRecordingId: '00000000-0000-4000-8000-000000000001', aliases: ['Working Title'] };
  const manifest = await stageCatalog({ source: root, items: [enriched,
    { ...enriched, id: 'fedcba9876543210'.repeat(4), relativePath: 'second.mp4', extension: 'mp4', status: 'review' }] }, destination);
  assert.equal(manifest.files, 1); assert.equal(manifest.items.length, 1);
  assert.equal(manifest.items[0].kind, 'mp3');
  assert.equal(manifest.items[0].relativePath, path.join('Example Artist', 'Example Artist - Example Track [01234567].mp3'));
  assert.equal(await readFile(path.join(destination, manifest.items[0].relativePath), 'utf8'), 'first-source');
  assert.equal(await readFile(path.join(root, 'first.mp3'), 'utf8'), 'first-source');
  assert.equal(JSON.parse(await readFile(path.join(destination, 'catalog.json'), 'utf8')).items[0].title, 'Example: Track?');
});

test('staging rejects paths outside the source and existing destinations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metadata-stage-guard-'));
  const parent = await mkdtemp(path.join(os.tmpdir(), 'metadata-stage-target-'));
  const id = 'abcdef0123456789'.repeat(4), item = { id, relativePath: '..\\outside.mp3', extension: 'mp3',
    status: 'enriched', title: 'Example', artist: 'Artist', musicBrainzRecordingId: '00000000-0000-4000-8000-000000000001' };
  await assert.rejects(stageCatalog({ source: root, items: [item] }, path.join(parent, 'escape')), /source library|ENOENT/);
  await mkdir(path.join(parent, 'exists'));
  await assert.rejects(stageCatalog({ source: root, items: [] }, path.join(parent, 'exists')), /EEXIST/);
});

test('staged names handle reserved and duplicate-looking metadata generically', () => {
  assert.equal(safePathSegment('CON'), '_CON');
  const base = { extension: 'mp3', title: 'Example', artist: 'Artist' };
  assert.notEqual(stagedRelativePath({ ...base, id: '11111111' + '0'.repeat(56) }),
    stagedRelativePath({ ...base, id: '22222222' + '0'.repeat(56) }));
});
