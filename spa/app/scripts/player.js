/** @import { MediaPort, MediaItem, PlaybackState } from './types.js' */
/** @param {number} value @param {number} min @param {number} max */
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
/** @param {number} value */
const finite = value => Number.isFinite(value) && value >= 0 ? value : 0;

/** Deterministic application API; neither callers nor a future executor touch the DOM. */
export class Player {
  /** @type {MediaPort} */ #media;
  /** @type {PlaybackState} */ #state = { mediaId: null, status: 'empty', position: 0, duration: 0, volume: 0.7, error: null };
  /** @type {Set<(state:PlaybackState)=>void>} */ #listeners = new Set();
  #revision = 0;
  #unsubscribe;
  /** @param {MediaPort} media */
  constructor(media) {
    this.#media = media;
    media.setVolume(this.#state.volume);
    this.#unsubscribe = media.on(event => this.#event(event));
  }
  get state() { return { ...this.#state }; }
  /** @param {(state:PlaybackState)=>void} listener */
  subscribe(listener) { this.#listeners.add(listener); listener(this.state); return () => { this.#listeners.delete(listener); }; }
  #emit() { for (const listener of this.#listeners) listener(this.state); }
  /** @param {MediaItem} item */
  select(item) {
    this.#revision++;
    this.#state = { ...this.#state, mediaId: item.id, status: 'loading', position: 0, duration: 0, error: null };
    try { this.#media.load(item.file); } catch { this.#fail('This local file could not be opened. Select it again.'); }
    this.#emit();
  }
  async play() {
    if (!this.#state.mediaId || this.#state.status === 'error') return;
    const revision = ++this.#revision;
    if (this.#state.status === 'ended') this.seek(0);
    try { await this.#media.play(); }
    catch {
      if (revision === this.#revision && this.#state.status !== 'error') {
        this.#state.status = 'paused';
        this.#state.error = 'Playback could not start. Press Play to retry, or select a supported MP3/MP4.';
        this.#emit();
      }
    }
  }
  pause() {
    if (!this.#state.mediaId || this.#state.status === 'error') return false;
    this.#revision++;
    this.#media.pause();
    if (!this.#media.read().paused) return false;
    this.#state.status = 'paused';
    this.#emit();
    return true;
  }
  stop() {
    if (!this.#state.mediaId || this.#state.status === 'error') return;
    this.#revision++;
    this.#media.pause();
    this.seek(0);
    this.#state.status = 'stopped';
    this.#emit();
  }
  toggle() { if (this.#state.status === 'playing') this.pause(); else void this.play(); }
  /** @param {number} seconds */
  seek(seconds) {
    if (!this.#state.mediaId || !Number.isFinite(seconds) || !this.#state.duration) return;
    const target = clamp(seconds, 0, this.#state.duration);
    try { this.#media.seek(target); this.#state.position = target; }
    catch { this.#state.error = 'This media is not ready to seek. Try again after loading.'; }
    this.#emit();
  }
  /** @param {number} seconds */ skip(seconds) { this.seek(this.#state.position + seconds); }
  /** @param {number} volume */
  setVolume(volume) {
    if (!Number.isFinite(volume)) return;
    this.#state.volume = clamp(volume, 0, 1);
    this.#media.setVolume(this.#state.volume);
    this.#emit();
  }
  /** @param {string} message */
  #fail(message) { this.#state.status = 'error'; this.#state.error = message; }
  /** @param {string} event */
  #event(event) {
    if (!this.#state.mediaId) return;
    const current = this.#media.read();
    this.#state.duration = finite(current.duration);
    this.#state.position = finite(current.position);
    if (current.error) this.#fail('Unable to decode this file. Check that its contents and codecs are supported by this browser.');
    else if (current.ended) this.#state.status = 'ended';
    else if (event === 'playing' && !current.paused) {
      this.#state.status = 'playing'; this.#state.error = null;
    } else if (event === 'pause' && current.paused && this.#state.status === 'playing') this.#state.status = 'paused';
    else if (event === 'loadedmetadata' && this.#state.status === 'loading') this.#state.status = 'ready';
    this.#emit();
  }
  dispose() { this.#revision++; this.#unsubscribe(); this.#media.dispose(); this.#listeners.clear(); }
}
