import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyMatchDecision, applyRecordingMetadata, decideCandidate, enrichCatalog, inferLocalMetadata, markEnrichmentEligibility, matchCatalog, musicBrainzQuery, MusicBrainzClient, prepareLookupMetadata, probeDurationMs, rankMusicBrainzCandidates, scanLibrary } from '../lib.mjs';

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

test('title-only evidence stays reviewable and query escaping is bounded', () => {
  const titleOnly = { title: 'Example Track Alpha', artist: '' }, ranked = rankMusicBrainzCandidates(titleOnly, recordings);
  assert.equal(decideCandidate(titleOnly, ranked).status, 'review');
  assert.equal(musicBrainzQuery({ title: 'Example "Quoted" Track', artist: 'Example Artist' }),
    'recording:"Example \\"Quoted\\" Track" AND artist:"Example Artist"');
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
