import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMedia, LocalLibrary } from '../app/scripts/library.js';
import { UIState } from '../app/scripts/ui-state.js';
test('classification is case insensitive, bounded, and explainable', () => {
  assert.equal(classifyMedia('track.MP3').kind, 'mp3');
  assert.equal(classifyMedia('track [KARAOKE].Mp4').kind, 'karaoke_mp4');
  assert.equal(classifyMedia('karaoke-night.mp4').kind, 'karaoke_mp4');
  assert.equal(classifyMedia('mykaraoketrack.mp4').kind, 'original_mp4');
  assert.equal(classifyMedia('track.mp4.exe'), null);
  assert.equal(classifyMedia('track.wav'), null);
  assert.match(classifyMedia('track.mp4').reason, /provisional/);
});
test('session IDs remain stable; same File deduplicates without collapsing equal titles', () => {
  const library = new LocalLibrary();
  const first = new File(['one'], 'same.mp3');
  const second = new File(['two'], 'same.mp3');
  const result = library.add([first, first, second, new File([], 'empty.mp4'), new File(['x'], 'other.txt')]);
  assert.equal(result.added.length, 2); assert.equal(result.rejected, 2);
  const id = result.added[0].id;
  library.add([first]);
  assert.equal(library.list().length, 2); assert.equal(library.get(id).file, first);
  assert.notEqual(result.added[1].id, id);
});
test('filters and search derive counts from the current list', () => {
  const library = new LocalLibrary();
  const ui = new UIState();
  library.add([new File(['x'], 'One.mp3'), new File(['x'], 'Two karaoke.mp4')]);
  ui.setFilter('karaoke_mp4'); assert.equal(ui.visible(library.list()).length, 1);
  ui.setQuery('missing'); assert.equal(ui.visible(library.list()).length, 0);
  ui.setFilter('all'); ui.setQuery(' ONE '); assert.equal(ui.visible(library.list()).length, 1);
});
