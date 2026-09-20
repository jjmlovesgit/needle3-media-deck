#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrichCatalog, markEnrichmentEligibility, matchCatalog, musicBrainzQuery, MusicBrainzClient, scanLibrary, stageCatalog, writeJson } from './lib.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url)), values = process.argv.slice(2), command = values.shift();
const option = (name, fallback) => { const index = values.indexOf('--' + name); return index >= 0 ? values[index + 1] : fallback; };
const has = name => values.includes('--' + name);
const usage = () => console.log('Usage:\n  node catalog.mjs scan --source <media-directory> [--output <catalog.json>]\n  node catalog.mjs plan [--catalog <catalog.json>] [--output <plan.json>]\n  node catalog.mjs match [--catalog <local.json>] [--output <matches.json>] [--limit <count>] [--require-artist] (--allow-network | --offline)\n  node catalog.mjs enrich [--catalog <matches.json>] [--output <enriched.json>] [--limit <count>] (--allow-network | --offline)\n  node catalog.mjs stage [--catalog <enriched.json>] [--destination <directory>]');
const checkedLimit = () => {
  const raw = option('limit', 'Infinity'), limit = raw === 'Infinity' ? Infinity : Number(raw);
  if ((!Number.isInteger(limit) || limit < 1) && limit !== Infinity) throw new Error('--limit must be a positive integer.');
  return limit;
};
const checkedNetwork = () => {
  if (!has('allow-network') && !has('offline')) throw new Error('Review a local plan first, then specify --allow-network or --offline.');
};
const client = contact => new MusicBrainzClient({ cacheDirectory: path.join(directory, '.cache', 'musicbrainz'), contact, offline: has('offline') });

try {
  if (command === 'scan') {
    const source = option('source'); if (!source) throw new Error('--source is required.');
    const output = path.resolve(option('output', path.join(directory, 'work', 'catalog.local.json'))), catalog = await scanLibrary(source);
    await writeJson(output, catalog); console.log(JSON.stringify({ output, files: catalog.items.length }, null, 2));
  } else if (command === 'plan') {
    const input = path.resolve(option('catalog', path.join(directory, 'work', 'catalog.local.json')));
    const output = path.resolve(option('output', path.join(directory, 'work', 'enrichment-plan.json')));
    const catalog = JSON.parse(await readFile(input, 'utf8'));
    const classified = markEnrichmentEligibility(catalog.items), eligible = classified.filter(item => item.eligibleForEnrichment);
    const plan = { schemaVersion: 1, provider: 'MusicBrainz', endpoint: 'https://musicbrainz.org/ws/2/recording/',
      notice: 'Each query contains locally inferred title and optional artist metadata.',
      excludedAlbums: classified.filter(item => item.status === 'excluded-album').length,
      excludedOverTenMinutes: classified.filter(item => item.status === 'excluded-long-form').length,
      queries: eligible.map(item => ({ id: item.id, relativePath: item.relativePath, query: musicBrainzQuery(item) })) };
    await writeJson(output, plan); console.log(JSON.stringify({ output, songQueries: plan.queries.length,
      excludedAlbums: plan.excludedAlbums, excludedOverTenMinutes: plan.excludedOverTenMinutes }, null, 2));
  } else if (command === 'match') {
    const input = path.resolve(option('catalog', path.join(directory, 'work', 'catalog.local.json')));
    const output = path.resolve(option('output', path.join(directory, 'work', 'catalog.matches.json')));
    const contact = option('contact', 'https://github.com/jjmlovesgit/needle3-media-deck');
    checkedNetwork(); const catalog = JSON.parse(await readFile(input, 'utf8'));
    const matched = await matchCatalog(catalog, client(contact), checkedLimit(), { requireArtist: has('require-artist') }); await writeJson(output, matched);
    console.log(JSON.stringify({ output, files: matched.items.length, phase: matched.phase, counts: matched.counts }, null, 2));
  } else if (command === 'enrich') {
    const input = path.resolve(option('catalog', path.join(directory, 'work', 'catalog.matches.json')));
    const output = path.resolve(option('output', path.join(directory, 'work', 'catalog.enriched.json')));
    const contact = option('contact', 'https://github.com/jjmlovesgit/needle3-media-deck');
    checkedNetwork(); const catalog = JSON.parse(await readFile(input, 'utf8'));
    const enriched = await enrichCatalog(catalog, client(contact), checkedLimit()); await writeJson(output, enriched);
    console.log(JSON.stringify({ output, files: enriched.items.length, phase: enriched.phase, counts: enriched.counts }, null, 2));
  } else if (command === 'stage') {
    const input = path.resolve(option('catalog', path.join(directory, 'work', 'catalog.enriched.json')));
    const destination = path.resolve(option('destination', path.join(directory, 'work', 'demo-library')));
    const catalog = JSON.parse(await readFile(input, 'utf8')), manifest = await stageCatalog(catalog, destination);
    console.log(JSON.stringify({ destination, files: manifest.files, manifest: path.join(destination, 'catalog.json') }, null, 2));
  } else { usage(); process.exitCode = command ? 1 : 0; }
} catch (error) { console.error(error.message); process.exitCode = 1; }
