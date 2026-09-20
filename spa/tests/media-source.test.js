import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MediaSource, byteRange, within } from '../scripts/media-source.mjs';
test('ranges clamp correctly and reject malformed/unsatisfiable requests', () => {
  assert.deepEqual(byteRange('bytes=5-999', 20), {start:5,end:19,partial:true});
  assert.deepEqual(byteRange('bytes=-5', 20), {start:15,end:19,partial:true});
  assert.equal(byteRange('bytes=30-', 20), null);
  assert.equal(byteRange('bytes=-0', 20), null);
  assert.equal(byteRange('bytes=0-1,3-4', 20), null);
  assert.equal(within(path.resolve('root'), path.resolve('root-other', 'song.mp3')), false);
});
test('read-only source indexes recursively with stable IDs, canonical duplicates and opaque access', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'media-source-test-'));
  try {
    await mkdir(path.join(root, 'album'));
    await writeFile(path.join(root, 'album', 'song.mp3'), '123456789');
    await writeFile(path.join(root, 'clip karaoke.mp4'), 'video');
    await writeFile(path.join(root, 'ignored.txt'), 'private');
    await link(path.join(root, 'album', 'song.mp3'), path.join(root, 'duplicate.mp3'));
    const source = new MediaSource({id:'test',path:root,readOnly:true});
    const first = await source.scan();
    assert.equal(first.items.length, 2);
    assert(first.items.every(item => !JSON.stringify(item).includes(root)));
    assert.equal(await source.openMedia('../ignored.txt'), null);
    const selected = await source.openMedia(first.items[0].id);
    assert(selected);
    await selected.handle.close();
    const next = await source.scan(true);
    assert.deepEqual(next.items.map(x => x.id), first.items.map(x => x.id));
    await rm(path.join(root, 'clip karaoke.mp4'));
    assert.equal((await source.scan(true)).items.length, 1);
  } finally { await rm(root, {recursive:true,force:true}); }
});
