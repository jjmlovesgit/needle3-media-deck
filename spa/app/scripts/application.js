import { matchMedia } from './matching.js';
import { LocalLibrary } from './library.js';
import { Player } from './player.js';
import { UIState } from './ui-state.js';

/** Typed application boundary for UI and future validated tool execution.
 * @param {import('./types.js').MediaPort} media
 */
export function createApplication(media) {
  const library = new LocalLibrary();
  const player = new Player(media);
  const ui = new UIState();
  return {
    library, player, ui,
    /** @param {import('./matching.js').MediaRequest} request */
    matchMedia(request) { return matchMedia(library.list(), request); },
    /** @param {string} id */
    playMedia(id) {
      const item = library.get(id);
      if (!item) throw new Error('Selected media is no longer available.');
      if (player.state.mediaId !== id) player.select(item);
      return player.play();
    }
  };
}
