import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const configUrl = new URL('../config/media-sources.json', import.meta.url);
const config = JSON.parse(await readFile(configUrl, 'utf8'));
const configDirectory = path.dirname(fileURLToPath(configUrl));
let unavailable = false;
for (const source of config.sources) {
  const sourcePath = path.resolve(configDirectory, source.path);
  try {
    if (!(await stat(sourcePath)).isDirectory()) throw new Error('Not a directory');
    console.log(source.id + ': available (read-only) — ' + sourcePath);
  } catch {
    unavailable = true;
    console.error(source.id + ': unavailable — ' + sourcePath);
  }
}
if (unavailable) process.exitCode = 1;
