import { normalizeMediaText } from './metadata.js';
/** @import { LibraryFilter } from './types.js' */
export class UIState {
  /** @type {LibraryFilter} */ filter = 'all';
  query = '';
  sort = 'title';
  albumId = '';
  /** @param {LibraryFilter} filter */
  setFilter(filter) { this.filter = filter; this.albumId = ''; }
  /** @param {string} query */ setQuery(query) { this.query = query; }
  /** @param {import('./types.js').MediaItem[]} items */
  visible(items) {
    const query = normalizeMediaText(this.query);
    return items.filter(item => (this.filter === 'all' || (this.filter === 'albums' ? Boolean(item.album) : item.kind === this.filter))
      && (!this.albumId || item.albumKey === this.albumId)
      && normalizeMediaText([item.title,item.artist,item.album].filter(Boolean).join(' ')).includes(query))
      .sort((a,b) => this.albumId ? (a.track ?? Infinity) - (b.track ?? Infinity) || a.title.localeCompare(b.title)
        : this.sort === 'artist' ? (a.artist || '').localeCompare(b.artist || '') || a.title.localeCompare(b.title)
        : this.sort === 'newest' ? (b.modified || 0) - (a.modified || 0) || a.title.localeCompare(b.title)
        : a.title.localeCompare(b.title));
  }
}
