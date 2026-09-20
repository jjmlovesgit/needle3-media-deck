import { inferMetadata } from './metadata.js';
/** @import { MediaItem, MediaKind } from './types.js' */

/** Extension is a hint; actual codec support is verified by the media element.
 * @param {string} name
 * @returns {{kind:MediaKind,reason:string}|null}
 */
export function classifyMedia(name) {
  if (/\.mp3$/i.test(name)) return { kind: 'mp3', reason: 'MP3 filename extension' };
  if (!/\.mp4$/i.test(name)) return null;
  const karaoke = /(?:^|[\s_.(\[\-])karaoke(?:$|[\s_.)\]\-])/i.test(name.replace(/\.mp4$/i, ''));
  return { kind: karaoke ? 'karaoke_mp4' : 'original_mp4',
    reason: karaoke ? 'MP4 with a standalone karaoke filename marker' : 'MP4 without a karaoke filename marker (provisional original)' };
}

/** Session library adapter. File identity cannot reveal canonical filesystem paths. */
export class LocalLibrary {
  /** @type {Map<string,MediaItem>} */ #items = new Map();
  /** @type {WeakMap<File,string>} */ #identity = new WeakMap();
  /** @param {MediaItem[]} items */
  replaceShared(items) {
    for (const [id, item] of this.#items) if (item.source === 'shared') this.#items.delete(id);
    for (const item of items) this.#items.set(item.id, item);
  }
  /** @returns {MediaItem[]} */ list() { return [...this.#items.values()]; }
  /** @param {string} id */ get(id) { return this.#items.get(id); }
  /** @param {Iterable<File>} files */
  add(files) {
    /** @type {MediaItem[]} */ const added = [];
    let rejected = 0;
    for (const file of files) {
      const classification = classifyMedia(file.name);
      if (!classification || file.size === 0) { rejected++; continue; }
      // Only suppress proven same File object; equal labels/size are not canonical identity.
      if (this.#identity.has(file)) continue;
      const id = crypto.randomUUID();
      const item = { id, ...inferMetadata(file.name), ...classification, file };
      this.#identity.set(file, id);
      this.#items.set(id, item);
      added.push(item);
    }
    return { added, rejected };
  }
}
