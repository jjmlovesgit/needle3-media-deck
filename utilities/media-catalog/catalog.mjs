#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrichCatalog, musicBrainzQuery, MusicBrainzClient, scanLibrary, writeJson } from './lib.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url)), values = process.argv.slice(2), command = values.shift();
const option = (name, fallback) => { const index = values.indexOf('--' + name); return index >= 0 ? values[index + 1] : fallback; };
const has = name => values.includes('--' + name);
const usage = () => console.log('Usage:\n  node catalog.mjs scan --source <media-directory> [--output <catalog.json>]\n  node catalog.mjs plan [--catalog <catalog.json>] [--output <plan.json>]\n  node catalog.mjs enrich [--catalog <catalog.json>] [--output <enriched.json>] [--limit <count>] (--allow-network | --offline) [--contact <URL-or-email>]');

try {
  if (command === 'scan') {
    const source = option('source'); if (!source) throw new Error('--source is required.');
    const output = path.resolve(option('output', path.join(directory, 'work', 'catalog.local.json'))), catalog = await scanLibrary(source);
    await writeJson(output, catalog); console.log(JSON.stringify({ output, files: catalog.items.length }, null, 2));
  } else if (command === 'plan') {
    const input = path.resolve(option('catalog', path.join(directory, 'work', 'catalog.local.json')));
    const output = path.resolve(option('output', path.join(directory, 'work', 'enrichment-plan.json')));
    const catalog = JSON.parse(await readFile(input, 'utf8'));
    const plan = { schemaVersion: 1, provider: 'MusicBrainz', endpoint: 'https://musicbrainz.org/ws/2/recording/',
      notice: 'Each query contains locally inferred title and optional artist metadata.',
      queries: catalog.items.map(item => ({ id: item.id, relativePath: item.relativePath, query: musicBrainzQuery(item) })) };
    await writeJson(output, plan); console.log(JSON.stringify({ output, queries: plan.queries.length }, null, 2));
  } else if (command === 'enrich') {
    const input = path.resolve(option('catalog', path.join(directory, 'work', 'catalog.local.json')));
    const output = path.resolve(option('output', path.join(directory, 'work', 'catalog.enriched.json')));
    const contact = option('contact', 'https://github.com/jjmlovesgit/needle3-media-deck');
    const rawLimit = option('limit', 'Infinity'), limit = rawLimit === 'Infinity' ? Infinity : Number(rawLimit);
    if ((!Number.isInteger(limit) || limit < 1) && limit !== Infinity) throw new Error('--limit must be a positive integer.');
    if (!has('allow-network') && !has('offline')) throw new Error('Review a local plan first, then specify --allow-network or --offline.');
    const catalog = JSON.parse(await readFile(input, 'utf8'));
    const client = new MusicBrainzClient({ cacheDirectory: path.join(directory, '.cache', 'musicbrainz'), contact, offline: has('offline') });
    const enriched = await enrichCatalog(catalog, client, limit); await writeJson(output, enriched);
    console.log(JSON.stringify({ output, files: enriched.items.length, counts: enriched.counts }, null, 2));
  } else { usage(); process.exitCode = command ? 1 : 0; }
} catch (error) { console.error(error.message); process.exitCode = 1; }
