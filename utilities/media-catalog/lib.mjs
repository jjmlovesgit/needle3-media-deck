import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MEDIA_EXTENSIONS = new Set(['.mp3', '.mp4']);

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
    const id = createHash('sha256').update(relativePath.toLowerCase() + '\0' + info.size).digest('hex');
    items.push({ id, relativePath, extension: path.extname(absolute).slice(1).toLowerCase(), size: info.size,
      modifiedMs: info.mtimeMs, title: local.title, artist: local.artist, album: local.album, track: local.track,
      year: null, durationMs: null, musicBrainzRecordingId: null, aliases: [], status: 'local',
      confidence: local.artist ? 0.65 : 0.45, provenance: { title: 'filename-or-folder',
        artist: local.artist ? 'filename' : null, album: local.album ? 'folder' : null,
        track: local.track ? 'filename' : null }, local });
  }
  return { schemaVersion: 1, source: root, generatedAt: new Date().toISOString(), items };
}

function similarity(left, right) {
  const a = normalize(left), b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const x = new Set(a.split(' ')), y = new Set(b.split(' '));
  return (2 * [...x].filter(token => y.has(token)).length) / (x.size + y.size);
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
  const margin = best.evidenceScore - (ranked[1]?.evidenceScore || 0);
  const accept = Boolean(local.artist) && best.apiScore >= .9 && best.titleSimilarity >= .85 && best.artistSimilarity >= .8 && margin >= .05;
  return { status: accept ? 'accepted' : 'review', confidence: Number(best.evidenceScore.toFixed(3)), best, margin };
}

export function applyDecision(item, decision, ranked) {
  const candidates = ranked.slice(0, 5).map(({ recording, artist, release, evidenceScore }) => ({
    musicBrainzRecordingId: recording.id, title: recording.title, artist, album: release?.title || '',
    year: release?.date ? Number(String(release.date).slice(0, 4)) || null : null,
    durationMs: Number(recording.length) || null, score: Number(evidenceScore.toFixed(3)) }));
  if (decision.status !== 'accepted') return { ...item, status: decision.status, confidence: decision.confidence, candidates };
  const selected = candidates[0];
  const aliases = [...new Set([item.title, ...(item.aliases || [])].filter(value => value && normalize(value) !== normalize(selected.title)))];
  return { ...item, title: selected.title, artist: selected.artist || item.artist, album: selected.album || item.album,
    year: selected.year, durationMs: selected.durationMs, musicBrainzRecordingId: selected.musicBrainzRecordingId,
    aliases, status: 'accepted', confidence: decision.confidence, provenance: { title: 'musicbrainz',
      artist: selected.artist ? 'musicbrainz' : item.provenance.artist, album: selected.album ? 'musicbrainz' : item.provenance.album,
      track: item.provenance.track, year: selected.year ? 'musicbrainz' : null,
      durationMs: selected.durationMs ? 'musicbrainz' : null }, candidates };
}

export function musicBrainzQuery(item) {
  const quote = value => `"${String(value).replace(/[\\"]/g, '\\$&')}"`;
  return [`recording:${quote(item.title)}`, ...(item.artist ? [`artist:${quote(item.artist)}`] : [])].join(' AND ');
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
export class MusicBrainzClient {
  constructor({ cacheDirectory, contact, fetchImpl = fetch, intervalMs = 1100, offline = false }) {
    Object.assign(this, { cacheDirectory, contact, fetchImpl, intervalMs, offline }); this.lastRequestAt = 0;
  }
  async search(item) {
    const query = musicBrainzQuery(item), key = createHash('sha256').update(query).digest('hex'), cacheFile = path.join(this.cacheDirectory, key + '.json');
    try { return JSON.parse(await readFile(cacheFile, 'utf8')); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (this.offline) return { recordings: [], offlineCacheMiss: true };
    }
    await mkdir(this.cacheDirectory, { recursive: true });
    const wait = Math.max(0, this.intervalMs - (Date.now() - this.lastRequestAt)); if (wait) await delay(wait);
    const url = new URL('https://musicbrainz.org/ws/2/recording/');
    url.searchParams.set('query', query); url.searchParams.set('fmt', 'json'); url.searchParams.set('limit', '10');
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      this.lastRequestAt = Date.now();
      response = await this.fetchImpl(url, { headers: { 'User-Agent': `Needle3MediaCatalog/0.1 (${this.contact})`, Accept: 'application/json' } });
      if (response.ok) break;
      if (![429, 503].includes(response.status) || attempt === 2) throw new Error(`MusicBrainz request failed with HTTP ${response.status}`);
      await delay(1500 * (attempt + 1));
    }
    const data = await response.json();
    await writeFile(cacheFile, JSON.stringify(data, null, 2) + '\n', 'utf8');
    return data;
  }
}

export async function enrichCatalog(catalog, client, limit = Infinity) {
  const items = []; let queried = 0;
  for (const item of catalog.items) {
    if (queried >= limit) { items.push(item); continue; }
    const data = await client.search(item); queried++;
    const ranked = rankMusicBrainzCandidates(item.local || item, data.recordings || []), decision = decideCandidate(item.local || item, ranked);
    items.push(applyDecision(item, decision, ranked));
  }
  const counts = items.reduce((result, item) => ({ ...result, [item.status]: (result[item.status] || 0) + 1 }), {});
  return { ...catalog, enrichedAt: new Date().toISOString(), provider: 'MusicBrainz', counts, items };
}

export async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
