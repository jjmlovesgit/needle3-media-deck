/** @import { MediaPort } from './types.js' */
/** One browser media element owns decoding for MP3 and MP4.
 * @param {HTMLVideoElement} element
 * @returns {MediaPort}
 */
export function createBrowserMedia(element) {
  /** @type {string|null} */ let url = null;
  return {
    load(file) {
      element.pause();
      element.removeAttribute('src');
      element.load();
      if (url) URL.revokeObjectURL(url);
      url = null;
      if (typeof file === 'string' && !/^\/media\/[a-f0-9]{64}$/.test(file)) throw new Error('Invalid media source');
      if (typeof file !== 'string') url = URL.createObjectURL(file);
      element.src = typeof file === 'string' ? file : url;
      element.load();
    },
    play: () => element.play(),
    pause: () => element.pause(),
    seek: seconds => { element.currentTime = seconds; },
    setVolume: volume => { element.volume = volume; },
    read: () => ({
      position: element.currentTime,
      duration: element.duration,
      paused: element.paused,
      ended: element.ended,
      error: Boolean(element.error)
    }),
    on(listener) {
      const events = ['loadedmetadata', 'durationchange', 'timeupdate', 'playing', 'pause', 'ended', 'error', 'waiting', 'seeked'];
      /** @param {Event} event */
      const handler = event => listener(event.type);
      events.forEach(event => element.addEventListener(event, handler));
      return () => events.forEach(event => element.removeEventListener(event, handler));
    },
    dispose() {
      element.pause();
      element.removeAttribute('src');
      element.load();
      if (url) URL.revokeObjectURL(url);
      url = null;
    }
  };
}
