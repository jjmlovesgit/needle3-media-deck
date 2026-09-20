import { readFile, stat } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('../config/media-sources.json', import.meta.url), 'utf8'));
let unavailable = false;
for (const source of config.sources) {
  try {
    if (!(await stat(source.path)).isDirectory()) throw new Error('Not a directory');
    console.log(source.id + ': available (read-only) — ' + source.path);
  } catch {
    unavailable = true;
    console.error(source.id + ': unavailable — ' + source.path);
  }
}
if (unavailable) process.exitCode = 1;
