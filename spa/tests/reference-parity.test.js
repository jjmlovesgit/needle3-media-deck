import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('reference CSS and meter artwork remain identical to the cloned baseline',async()=>{
 const source=await readFile(new URL('../../playback_server.py',import.meta.url),'utf8');
 const expected=source.match(/<style>([\s\S]*?)<\/style>/)[1].replaceAll('{{','{').replaceAll('}}','}');
 assert.equal(await readFile(new URL('../app/styles/reference.css',import.meta.url),'utf8'),expected);
 assert.deepEqual(await readFile(new URL('../app/assets/vu-meter-face.svg',import.meta.url)),await readFile(new URL('../../assets/vu-meter-face.svg',import.meta.url)));
});
