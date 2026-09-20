import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sha256=value=>createHash('sha256').update(value).digest('hex');
test('committed console CSS and meter artwork retain their reviewed baselines',async()=>{
 assert.equal(sha256(await readFile(new URL('../app/styles/reference.css',import.meta.url))),'df6ed7bc1d480316f5216756b7170a12eb1fb4ffd1e31d187a6c208ea7449369');
 assert.equal(sha256(await readFile(new URL('../app/assets/vu-meter-face.svg',import.meta.url))),'aabf81912c756e7afeb8cad6b9265b414a2d971cb0de896e78d790baea6c9236');
});
