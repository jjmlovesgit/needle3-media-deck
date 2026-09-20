/** Filename/directory metadata following the reference library's display rules.
 * @param {string} relativePath
 */
export function inferMetadata(relativePath) {
  const parts = relativePath.split(/[\\/]/);
  const filename = parts.pop() || '';
  const folder = parts.at(-1) || '';
  const clean = value => value.replace(/_\d{8}_\d{6}_.+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  let title = clean(folder && /^(source|video|audio|karaoke)\.(mp3|mp4)$/i.test(filename) ? folder : filename.replace(/\.(mp3|mp4)$/i, ''));
  const numbered = /^(\d{1,3})\s*[-._]\s*(.+)$/.exec(title);
  const track = numbered ? Number(numbered[1]) : null;
  if (numbered) title = numbered[2];
  let artist = '';
  const named = /^(.+?)\s+-\s+(.+)$/.exec(title);
  if (named) { artist = named[1]; title = named[2]; }
  const album = /\s*-\s*Tracks$/i.test(folder) ? clean(folder.replace(/\s*-\s*Tracks$/i, '')) : '';
  return { title: title || filename, artist, album, track, metadataSource: 'Filename / folder',
    albumKey: album ? parts.join('/') : '' };
}

/** @param {string} value */
export function normalizeMediaText(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
    .replace(/[’']/g, ' ').replace(/\./g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Album grouping stays separate from title identity.
 * @param {import('./types.js').MediaItem[]} items
 */
export function groupAlbums(items) {
  const groups = new Map();
  for (const item of items) {
    if (!item.album || !item.albumKey) continue;
    if (!groups.has(item.albumKey)) groups.set(item.albumKey, { id: item.albumKey, title: item.album, tracks: [] });
    groups.get(item.albumKey).tracks.push(item);
  }
  return [...groups.values()].map(album => ({
    ...album, tracks: album.tracks.sort((a,b) => (a.track ?? Infinity) - (b.track ?? Infinity) || a.title.localeCompare(b.title))
  })).sort((a,b) => a.title.localeCompare(b.title));
}
