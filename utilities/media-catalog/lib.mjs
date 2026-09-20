import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

export const MEDIA_EXTENSIONS = new Set(['.mp3', '.mp4']);
export const MAX_ENRICHMENT_DURATION_MS = 10 * 60 * 1000;
const execFileAsync = promisify(execFile);

export function normalize(value = '') {
  return String(value).normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
    .replace(/[’']/g, ' ').replace(/\./g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const clean = value => value.replace(/_\d{8}_\d{6}_.+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

export function inferLocalMetadata(relativePath) {
  const parts = relativePath.split(/[\\/]/), filename = parts.pop() || '', folder = parts.at(-1) || '';
  let title = clean(folder && /^(source|video|audio|karaoke)\.(mp3|mp4)$/i.test(filename) ? folder : filename.replace(/\.(mp3|mp4)$/i, ''));
  const numbered = /^(\d{1,3})\s*[-._]\s*(.+)$/.exec(title), track = numbered ? Number(numbered[1]) : null;
  if (numbered) title = numbered[2];
  let artist = '';
  const named = /^(.+?)\s+-\s+(.+)$/.exec(title);
  if (named) { artist = named[1]; title = named[2]; }
  const album = /\s*-\s*Tracks$/i.test(folder) ? clean(folder.replace(/\s*-\s*Tracks$/i, '')) : '';
  return { title: title || filename, artist, album, track };
}

async function walk(root, directory = root, found = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(root, absolute, found);
    else if (entry.isFile() && MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) found.push(absolute);
  }
  return found;
}

export async function scanLibrary(source) {
  const root = path.resolve(source), files = await walk(root), items = [];
  for (const absolute of files) {
    const info = await stat(absolute), relativePath = path.relative(root, absolute), local = inferLocalMetadata(relativePath);
    const durationMs = await probeDurationMs(absolute);
    const id = createHash('sha256').update(relativePath.toLowerCase() + '\0' + info.size).digest('hex');
    items.push({ id, relativePath, extension: path.extname(absolute).slice(1).toLowerCase(), size: info.size,
      modifiedMs: info.mtimeMs, title: local.title, artist: local.artist, album: local.album, track: local.track,
      year: null, durationMs, musicBrainzRecordingId: null, aliases: [], status: 'local',
      confidence: local.artist ? 0.65 : 0.45, provenance: { title: 'filename-or-folder',
        artist: local.artist ? 'filename' : null, album: local.album ? 'folder' : null,
        track: local.track ? 'filename' : null }, local });
  }
  return { schemaVersion: 1, source: root, generatedAt: new Date().toISOString(), items: markEnrichmentEligibility(items) };
}

export async function probeDurationMs(filename, exec = execFileAsync) {
  try {
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', filename], { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 });
    const seconds = Number(String(stdout).trim());
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
  } catch { return null; }
}

function tokenCoverage(left, right) {
  const a = new Set(normalize(left).split(' ').filter(Boolean)), b = new Set(normalize(right).split(' ').filter(Boolean));
  if (!a.size || !b.size) return 0;
  return [...a].filter(token => b.has(token)).length / Math.min(a.size, b.size);
}

/** Mark long-form album media without excluding the individual songs inside its track folder. */
export function markEnrichmentEligibility(items) {
  const albumNames = [...new Set(items.map(item => item.album).filter(Boolean))];
  return items.map(item => {
    const individualTrack = Number.isInteger(item.track) || /(?:^|[\\/]).+\s-\sTracks[\\/]/i.test(item.relativePath);
    const longFormLabel = /\b(?:full|complete)\s+album\b|\bgreatest\s+hits\b|\bbest\s+of\b|\banthology\b|\bcompilation\b/i.test(item.title);
    const duplicatesSplitAlbum = !individualTrack && albumNames.some(album => {
      const shorter = Math.min(normalize(album).split(' ').length, normalize(item.title).split(' ').length);
      return shorter >= 3 && tokenCoverage(album, item.title) >= .85;
    });
    const excludedAlbum = !individualTrack && (longFormLabel || duplicatesSplitAlbum);
    const excludedDuration = Number.isFinite(item.durationMs) && item.durationMs > MAX_ENRICHMENT_DURATION_MS;
    const excluded = excludedAlbum || excludedDuration;
    const status = excludedAlbum ? 'excluded-album' : excludedDuration ? 'excluded-long-form'
      : ['excluded-album','excluded-long-form'].includes(item.status) ? 'local' : item.status;
    const exclusionReason = excludedAlbum ? (longFormLabel ? 'long-form album label' : 'matching split-track album')
      : excludedDuration ? 'duration over 10 minutes' : undefined;
    return { ...item, enrichmentType: excludedAlbum ? 'album' : 'song', eligibleForEnrichment: !excluded, status,
      ...(exclusionReason ? { exclusionReason } : {}) };
  });
}

function similarity(left, right) {
  const a = normalize(left), b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const x = a.split(' '), y = b.split(' '), remaining = [...y]; let intersection = 0;
  for (const token of x) { const index = remaining.indexOf(token); if (index >= 0) { intersection++; remaining.splice(index, 1); } }
  const tokenDice = (2 * intersection) / (x.length + y.length), lengthRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return tokenDice * (.7 + .3 * lengthRatio);
}
const artistCredit = recording => (recording['artist-credit'] || []).map(credit => credit.name || credit.artist?.name || '').filter(Boolean).join('');
const bestRelease = recording => [...(recording.releases || [])].sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')))[0] || null;

export function rankMusicBrainzCandidates(local, recordings = []) {
  return recordings.map(recording => {
    const artist = artistCredit(recording), titleSimilarity = similarity(local.title, recording.title);
    const artistSimilarity = local.artist ? similarity(local.artist, artist) : 0, apiScore = Number(recording.score || 0) / 100;
    const evidenceScore = local.artist ? apiScore * .45 + titleSimilarity * .35 + artistSimilarity * .20 : apiScore * .55 + titleSimilarity * .45;
    return { recording, artist, release: bestRelease(recording), titleSimilarity, artistSimilarity, apiScore, evidenceScore };
  }).sort((a, b) => b.evidenceScore - a.evidenceScore || b.apiScore - a.apiScore);
}

export function decideCandidate(local, ranked) {
  const best = ranked[0];
  if (!best || best.apiScore < .7 || best.titleSimilarity < .65) return { status: 'unmatched', confidence: 0 };
  const identity = candidate => normalize(candidate.recording.title) + '\0' + normalize(candidate.artist);
  const competingIdentity = ranked.find(candidate => identity(candidate) !== identity(best));
  const margin = best.evidenceScore - (competingIdentity?.evidenceScore || 0);
  const accept = Boolean(local.artist) && best.apiScore >= .9 && best.titleSimilarity >= .85 && best.artistSimilarity >= .8 && margin >= .05;
  return { status: accept ? 'accepted' : 'review', confidence: Number(best.evidenceScore.toFixed(3)), best, margin };
}

export function applyMatchDecision(item, decision, ranked) {
  const candidates = ranked.slice(0, 5).map(({ recording, artist, release, evidenceScore }) => ({
    musicBrainzRecordingId: recording.id, title: recording.title, artist,
    score: Number(evidenceScore.toFixed(3)) }));
  if (decision.status !== 'accepted') return { ...item, status: decision.status, confidence: decision.confidence, candidates };
  return { ...item, status: 'matched', confidence: decision.confidence,
    matchedRecordingId: candidates[0].musicBrainzRecordingId, candidates };
}

export function applyRecordingMetadata(item, recording) {
  const artist = artistCredit(recording), release = bestRelease(recording);
  const selected = { title: recording.title || item.title, artist, album: release?.title || '',
    year: release?.date ? Number(String(release.date).slice(0, 4)) || null : null,
    durationMs: Number(recording.length) || null };
  const aliases = [...new Set([item.title, ...(item.aliases || [])].filter(value => value && normalize(value) !== normalize(selected.title)))];
  return { ...item, title: selected.title, artist: selected.artist || item.artist, album: selected.album || item.album,
    year: selected.year, durationMs: selected.durationMs, musicBrainzRecordingId: recording.id,
    aliases, status: 'enriched', provenance: { title: 'musicbrainz',
      artist: selected.artist ? 'musicbrainz' : item.provenance.artist, album: selected.album ? 'musicbrainz' : item.provenance.album,
      track: item.provenance.track, year: selected.year ? 'musicbrainz' : null,
      durationMs: selected.durationMs ? 'musicbrainz' : null } };
}

export function prepareLookupMetadata(item) {
  const local = item.local || item;
  const originalTitle = String(local.title || '');
  const title = originalTitle
    .replace(/^\s*(?:(?:official|unofficial)\s+)?(?:music\s+)?video\s*[-:]\s*/i, '')
    .replace(/\s*[-–—]\s*live\s+at\b.*$/i, '')
    .replace(/\s+(?:official|unofficial)\s+(?:(?:music\s+)?video|audio|clip)(?:\s+by\s+.+)?(?:\s*[-–—]?\s*(?:hd|hq|4k|remaster(?:ed)?|pro\s+shot))*.*$/i, '')
    .replace(/\s+(?:official|unofficial)\s*$/i, '')
    .replace(/\s+(?:(?:official|unofficial)\s+)?(?:lyric\s+)?video\s*$/i, '')
    .replace(/\s*[-–—]\s*karaoke\s*$/i, '')
    .replace(/\s+(?:19|20)\d{2}\s+(?:hd|hq|4k|remaster(?:ed)?)\s*$/i, '')
    .replace(/\s+(?:hd|hq|4k|remaster(?:ed)?)\s*$/i, '').trim() || originalTitle;
  let artist = String(local.artist || '').trim();
  if (!artist && local.album) {
    const collectionArtist = /^\s*\d+(?:\.\d+)?\s+hours?\s+of\s+(.+?)\s+(?:for|to|at|during)\b/i.exec(local.album);
    if (collectionArtist) artist = collectionArtist[1].trim();
  }
  return { ...local, title, artist };
}

export function musicBrainzQuery(item) {
  const lookup = prepareLookupMetadata(item);
  const quote = value => `"${String(value).replace(/[\\"]/g, '\\$&')}"`;
  return [`recording:${quote(lookup.title)}`, ...(lookup.artist ? [`artist:${quote(lookup.artist)}`] : [])].join(' AND ');
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const minimalSearchResponse = data => ({ recordings: (data?.recordings || []).map(recording => ({
  id: recording.id, title: recording.title, score: recording.score,
  'artist-credit': (recording['artist-credit'] || []).map(credit => ({ name: credit.name || credit.artist?.name || '' }))
})) });
export class MusicBrainzClient {
  constructor({ cacheDirectory, contact, fetchImpl = fetch, intervalMs = 1100, offline = false }) {
    Object.assign(this, { cacheDirectory, contact, fetchImpl, intervalMs, offline }); this.lastRequestAt = 0;
  }
  async search(item) {
    const query = musicBrainzQuery(item), key = createHash('sha256').update(query).digest('hex'), cacheFile = path.join(this.cacheDirectory, key + '.json');
    const url = new URL('https://musicbrainz.org/ws/2/recording/');
    url.searchParams.set('query', query); url.searchParams.set('fmt', 'json'); url.searchParams.set('limit', '10');
    return this.request(cacheFile, url, { recordings: [], offlineCacheMiss: true }, minimalSearchResponse);
  }
  async lookup(recordingId) {
    if (!/^[a-f0-9-]{36}$/i.test(recordingId)) throw new Error('Invalid MusicBrainz recording ID.');
    const cacheFile = path.join(this.cacheDirectory, 'lookup', recordingId.toLowerCase() + '.json');
    const url = new URL(`https://musicbrainz.org/ws/2/recording/${recordingId}`);
    url.searchParams.set('inc', 'artist-credits+releases'); url.searchParams.set('fmt', 'json');
    return this.request(cacheFile, url, null);
  }
  async request(cacheFile, url, offlineFallback, transform = value => value) {
    try {
      const cached = transform(JSON.parse(await readFile(cacheFile, 'utf8')));
      await writeFile(cacheFile, JSON.stringify(cached, null, 2) + '\n', 'utf8');
      return cached;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (this.offline) return offlineFallback;
    }
    await mkdir(path.dirname(cacheFile), { recursive: true });
    const wait = Math.max(0, this.intervalMs - (Date.now() - this.lastRequestAt)); if (wait) await delay(wait);
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      this.lastRequestAt = Date.now();
      response = await this.fetchImpl(url, { headers: { 'User-Agent': `Needle3MediaCatalog/0.1 (${this.contact})`, Accept: 'application/json' } });
      if (response.ok) break;
      if (![429, 503].includes(response.status) || attempt === 2) throw new Error(`MusicBrainz request failed with HTTP ${response.status}`);
      await delay(1500 * (attempt + 1));
    }
    const data = transform(await response.json());
    await writeFile(cacheFile, JSON.stringify(data, null, 2) + '\n', 'utf8');
    return data;
  }
}

export async function matchCatalog(catalog, client, limit = Infinity, { requireArtist = false } = {}) {
  const items = []; let queried = 0;
  for (const item of markEnrichmentEligibility(catalog.items)) {
    if (!item.eligibleForEnrichment) { items.push(item); continue; }
    if (requireArtist && !prepareLookupMetadata(item).artist) { items.push({ ...item, status: 'skipped-no-artist' }); continue; }
    if (queried >= limit) { items.push(item); continue; }
    const data = await client.search(item); queried++;
    const lookup = prepareLookupMetadata(item);
    const ranked = rankMusicBrainzCandidates(lookup, data.recordings || []), decision = decideCandidate(lookup, ranked);
    items.push(applyMatchDecision(item, decision, ranked));
  }
  const counts = items.reduce((result, item) => ({ ...result, [item.status]: (result[item.status] || 0) + 1 }), {});
  return { ...catalog, matchedAt: new Date().toISOString(), provider: 'MusicBrainz', phase: 'match', counts, items };
}

export async function enrichCatalog(catalog, client, limit = Infinity) {
  const items = []; let queried = 0;
  for (const item of catalog.items) {
    if (item.status !== 'matched' || !item.matchedRecordingId || queried >= limit) { items.push(item); continue; }
    const recording = await client.lookup(item.matchedRecordingId); queried++;
    if (!recording) { items.push({ ...item, status: 'metadata-unavailable' }); continue; }
    items.push(applyRecordingMetadata(item, recording));
  }
  const counts = items.reduce((result, item) => ({ ...result, [item.status]: (result[item.status] || 0) + 1 }), {});
  return { ...catalog, enrichedAt: new Date().toISOString(), provider: 'MusicBrainz', phase: 'metadata', counts, items };
}

export async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
