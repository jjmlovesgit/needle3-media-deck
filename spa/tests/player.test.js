import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../app/scripts/player.js';
import { createApplication } from '../app/scripts/application.js';

function fixture() {
  let listener;
  let snapshot = { position: 0, duration: NaN, paused: true, ended: false, error: false };
  const port = {
    on(fn) { listener = fn; return () => { listener = () => {}; }; },
    read: () => snapshot, load() { snapshot = { position: 0, duration: NaN, paused: true, ended: false, error: false }; },
    play: async () => {}, pause() { snapshot.paused = true; },
    seek(value) { snapshot.position = value; snapshot.ended = false; },
    setVolume(value) { port.volume = value; }, dispose() { port.disposed = true; },
    emit(event, changes = {}) { Object.assign(snapshot, changes); listener(event); }
  };
  const player = new Player(port);
  const item = { id: 'one', file: new File(['bytes'], 'one.mp3'), kind: 'mp3', title: 'one', reason: 'extension' };
  return { port, player, item };
}
test('metadata, actual playing, pause, stop, seek boundaries and volume', async () => {
  const { port, player, item } = fixture();
  assert.equal(player.state.status, 'empty');
  player.select(item);
  assert.equal(player.state.status, 'loading');
  assert.equal(player.state.duration, 0);
  port.emit('loadedmetadata', { duration: 42 });
  assert.equal(player.state.status, 'ready');
  await player.play();
  assert.equal(player.state.status, 'ready', 'play promise alone is not playback confirmation');
  port.emit('playing', { paused: false });
  assert.equal(player.state.status, 'playing');
  player.skip(10); assert.equal(player.state.position, 10);
  player.skip(-100); assert.equal(player.state.position, 0);
  player.seek(100); assert.equal(player.state.position, 42);
  player.seek(NaN); assert.equal(player.state.position, 42);
  assert.equal(player.pause(),true); assert.equal(player.state.status, 'paused');
  player.stop(); assert.equal(player.state.status, 'stopped'); assert.equal(player.state.position, 0);
  port.emit('pause'); assert.equal(player.state.status, 'stopped');
  player.setVolume(2); assert.equal(port.volume, 1);
  player.setVolume(-1); assert.equal(port.volume, 0);
  player.setVolume(NaN); assert.equal(port.volume, 0);
  player.dispose(); assert.equal(port.disposed, true);
});
test('late rejection from replaced source cannot overwrite new selection', async () => {
  const { port, player, item } = fixture();
  let reject;
  port.play = () => new Promise((_, fail) => { reject = fail; });
  player.select(item); const pending = player.play();
  player.select({ ...item, id: 'two' });
  reject(new Error('interrupted')); await pending;
  assert.equal(player.state.mediaId, 'two');
  assert.equal(player.state.status, 'loading');
  assert.equal(player.state.error, null);
});
test('stop invalidates a pending play rejection', async () => {
  const { port, player, item } = fixture();
  let reject;
  port.play = () => new Promise((_, fail) => { reject = fail; });
  player.select(item); port.emit('loadedmetadata', { duration: 42 });
  const pending = player.play(); player.stop(); reject(new Error('aborted')); await pending;
  assert.equal(player.state.status, 'stopped');
});
test('autoplay rejection is recoverable; decode error is visible', async () => {
  const { port, player, item } = fixture();
  player.select(item);
  port.play = async () => { throw new Error('blocked'); };
  await player.play();
  assert.equal(player.state.status, 'paused'); assert.match(player.state.error, /Press Play/);
  port.play = async () => {};
  await player.play(); port.emit('playing', { paused: false });
  assert.equal(player.state.error, null);
  port.emit('error', { error: true });
  assert.equal(player.state.status, 'error'); assert.match(player.state.error, /decode/);
});
test('ended playback restarts at zero and UI receives snapshots', async () => {
  const { port, player, item } = fixture();
  player.select(item); port.emit('ended', { duration: 42, position: 42, ended: true });
  assert.equal(player.state.status, 'ended');
  await player.play(); assert.equal(player.state.position, 0);
  const copy = player.state; copy.volume = 0;
  assert.equal(player.state.volume, 0.7);
});
test('application rejects a stale media ID', () => {
  const { port } = fixture();
  const app = createApplication(port);
  assert.throws(() => app.playMedia('missing'), /no longer available/);
});
