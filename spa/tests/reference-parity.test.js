import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sha256=value=>createHash('sha256').update(value).digest('hex');
test('committed console CSS and meter artwork retain their reviewed baselines',async()=>{
 assert.equal(sha256(await readFile(new URL('../app/styles/reference.css',import.meta.url))),'7f2030b1c871ae66db80459614a34bc2f40ae8dc1593421553a0499296bba5c5');
 assert.equal(sha256(await readFile(new URL('../app/assets/vu-meter-face.svg',import.meta.url))),'aabf81912c756e7afeb8cad6b9265b414a2d971cb0de896e78d790baea6c9236');
});
