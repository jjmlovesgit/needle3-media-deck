import { inferMetadata } from '../app/scripts/metadata.js';
import { readdir, realpath, stat, open, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { classifyMedia } from '../app/scripts/library.js';

export function within(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}
export function byteRange(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return null;
  return { start, end, partial: true };
}

const manifestKey = value => String(value || '').replace(/\\/g, '/');
async function readCatalogMetadata(root) {
  try {
    const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
    if (!Array.isArray(catalog.items)) return new Map();
    return new Map(catalog.items.filter(item => item && typeof item.relativePath === 'string')
      .map(item => [manifestKey(item.relativePath), item]));
  } catch { return new Map(); }
}

/** Read-only development adapter. No filesystem paths are accepted from HTTP clients. */
export class MediaSource {
  #records = new Map();
  #manifest;
  #pending;
  constructor(source) {
    if (!source || source.readOnly !== true || !path.isAbsolute(source.path)) throw new Error('An absolute read-only media source is required.');
    this.source = source;
  }
  async scan(refresh = false) {
    if (this.#pending) return this.#pending;
    if (this.#manifest && !refresh) return this.#manifest;
    this.#pending = this.#scan();
    try { return await this.#pending; } finally { this.#pending = null; }
  }
  async #scan() {
    const root = await realpath(this.source.path);
    const catalogMetadata = await readCatalogMetadata(root);
    const records = new Map();
    const identities = new Set();
    let skipped = 0;
    const visit = async directory => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        // Never follow symlinks/junctions into another library.
        if (entry.isSymbolicLink()) { skipped++; continue; }
        const filename = path.join(directory, entry.name);
        try {
          const canonical = await realpath(filename);
          if (!within(root, canonical)) { skipped++; continue; }
          if (entry.isDirectory()) { await visit(canonical); continue; }
          const classification = classifyMedia(entry.name);
          if (!entry.isFile() || !classification) continue;
          const info = await stat(canonical);
          if (!info.size) { skipped++; continue; }
          const identity = info.ino ? info.dev + ':' + info.ino : canonical;
          if (identities.has(identity)) continue;
          identities.add(identity);
          const id = createHash('sha256').update(this.source.id + '\0' + canonical).digest('hex');
          const relativePath = path.relative(root, canonical);
          const inferred = inferMetadata(relativePath), catalogItem = catalogMetadata.get(manifestKey(relativePath));
          const metadata = catalogItem ? { ...inferred,
            title: typeof catalogItem.title === 'string' && catalogItem.title.trim() ? catalogItem.title.trim() : inferred.title,
            artist: typeof catalogItem.artist === 'string' ? catalogItem.artist.trim() : inferred.artist,
            album: typeof catalogItem.album === 'string' ? catalogItem.album.trim() : inferred.album,
            track: Number.isInteger(catalogItem.track) ? catalogItem.track : inferred.track,
            year: Number.isInteger(catalogItem.year) ? catalogItem.year : null,
            durationMs: Number.isFinite(catalogItem.durationMs) ? catalogItem.durationMs : null,
            musicBrainzRecordingId: typeof catalogItem.musicBrainzRecordingId === 'string' ? catalogItem.musicBrainzRecordingId : null,
            aliases: Array.isArray(catalogItem.aliases) ? catalogItem.aliases.filter(value => typeof value === 'string') : [],
            metadataSource: 'Catalog' } : inferred;
          if (metadata.albumKey) metadata.albumKey = createHash('sha256').update(this.source.id + metadata.albumKey).digest('hex');
          const item = { id, ...metadata, modified: info.mtimeMs, ...classification,
            relativePath, url: '/media/' + id };
          records.set(id, { filename: canonical, root, item });
        } catch { skipped++; }
      }
    };
    await visit(root);
    this.#records = records;
    this.#manifest = { sourceId: this.source.id, items: [...records.values()].map(record => record.item), skipped };
    return this.#manifest;
  }
  async openMedia(id) {
    const record = this.#records.get(id);
    if (!record) return null;
    const canonical = await realpath(record.filename);
    if (!within(record.root, canonical) || canonical !== record.filename) return null;
    const handle = await open(canonical, 'r');
    const info = await handle.stat();
    if (!info.isFile() || !info.size) { await handle.close(); return null; }
    return { handle, size: info.size, mime: record.item.kind === 'mp3' ? 'audio/mpeg' : 'video/mp4' };
  }
}
