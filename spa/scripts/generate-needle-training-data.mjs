#!/usr/bin/env node
/**
 * Create local, song-grouped Needle fine-tuning data from a Media Deck catalog.
 * The generated JSONL is ignored by Git because it contains the local demo catalog.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  if (!key?.startsWith('--')) throw new Error('Expected --option value pairs.');
  options.set(key.slice(2), process.argv[index + 1]);
}
const catalogPath = path.resolve(options.get('catalog') || path.join(root, 'demo', 'catalog.json'));
const toolsPath = path.resolve(options.get('tools') || path.join(root, 'spa', 'app', 'media-tools.json'));
const outputDirectory = path.resolve(options.get('out') || path.join(root, 'demo', 'needle-training-data'));
const seed = options.get('seed') || 'media-deck-v1';
const system = 'Route one standalone Media Deck command. Return only grounded tool calls. For named playback, copy the complete requested title and artist spans. A final literal MP3 means media_type mp3; a final literal MP4 means media_type mp4; otherwise media_type any. Do not infer a media format from title words.';
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const tools = JSON.parse(await readFile(toolsPath, 'utf8'));
const compactTools = answers => {
  const names = new Set(answers.map(answer => answer.name));
  // An unsupported request still needs a small, plausible tool set so the
  // empty answer is supervised without overflowing the trainer context.
  if (!names.size) ['control_playback', 'set_volume', 'show_library_panel'].forEach(name => names.add(name));
  return tools.filter(tool => names.has(tool.name));
};

const normalize = value => String(value || '').toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const hash = value => {
  let state = 2166136261;
  for (const character of value) { state ^= character.charCodeAt(0); state = Math.imul(state, 16777619); }
  return state >>> 0;
};
const groupKey = item => `${normalize(item.artist)}|${normalize(item.title)}`;
const kindFormat = kind => kind === 'mp3' ? 'mp3' : 'mp4';
const mediaArguments = (item, title, media_type) => ({
  title,
  ...(item.artist ? { artist: item.artist } : {}),
  media_type
});
const row = (query, answers, reasoning) => ({ query, tools: compactTools(answers), answers, reasoning, system });
const call = (name, arguments_ = {}) => ({ name, arguments: arguments_ });
const pushVariants = (rows, item, title, mediaType) => {
  const artist = item.artist;
  if (mediaType === 'any') {
    const named = artist ? [
      `Play ${artist} ${title}`,
      `Please play ${artist} ${title}`,
      `Play ${title} by ${artist}`,
      `Please play ${title} by ${artist}`
    ] : [`Play ${title}`, `Please play ${title}`];
    for (const query of named) rows.push(row(query, [call('play_media', mediaArguments(item, title, mediaType))],
      `The requested title is "${title}"${artist ? `; "${artist}" is the artist` : ''}; no final format was requested.`));
    return;
  }
  const suffix = mediaType.toUpperCase();
  const formatted = artist ? [
    `Play ${artist} ${title} ${suffix}`,
    `Please play ${title} by ${artist} ${suffix}`,
    `Play ${title} ${suffix}`
  ] : [`Play ${title} ${suffix}`, `Please play ${title} ${suffix}`];
  for (const query of formatted) rows.push(row(query, [call('play_media', mediaArguments(item, title, mediaType))],
    `The final literal ${suffix} selects ${mediaType}; "${title}" is the complete requested title.`));
};
const groups = new Map();
for (const item of catalog.items || []) {
  if (!item?.title || !['mp3', 'original_mp4', 'karaoke_mp4'].includes(item.kind)) continue;
  const key = groupKey(item);
  if (!groups.has(key)) groups.set(key, { key, items: [] });
  groups.get(key).items.push(item);
}
if (groups.size < 3) throw new Error('Catalog needs at least three song groups.');

const allGroups = [...groups.values()].sort((left, right) => hash(seed + left.key) - hash(seed + right.key));
const targets = { train: Math.round(allGroups.length * .70), validation: Math.round(allGroups.length * .15) };
targets.test = allGroups.length - targets.train - targets.validation;
const splits = { train: [], validation: [], test: [] };
const assigned = new Set();
// Preserve rare formats in both evaluation splits whenever the catalog has
// enough distinct song groups. A song group is still assigned only once.
for (const kind of ['karaoke_mp4', 'original_mp4', 'mp3']) {
  for (const splitName of ['train', 'validation', 'test']) {
    const candidate = allGroups.find(group => !assigned.has(group.key)
      && group.items.some(item => item.kind === kind));
    if (!candidate || splits[splitName].length >= targets[splitName]) continue;
    splits[splitName].push(candidate);
    assigned.add(candidate.key);
  }
}
for (const group of allGroups) {
  if (assigned.has(group.key)) continue;
  const destination = splits.train.length < targets.train ? 'train'
    : splits.validation.length < targets.validation ? 'validation' : 'test';
  splits[destination].push(group);
}

const staticRows = [
  row('Pause playback', [call('control_playback', { action: 'pause' })], 'Pause requests the pause transport action.'),
  row('Resume the current track', [call('control_playback', { action: 'play' })], 'Resume requests the play transport action.'),
  row('Stop playback', [call('control_playback', { action: 'stop' })], 'Stop requests the stop transport action.'),
  row('Play the next track', [call('control_playback', { action: 'next' })], 'Next track requests the next transport action.'),
  row('Play the previous track', [call('control_playback', { action: 'previous' })], 'Previous track requests the previous transport action.'),
  row('Rewind 10 seconds', [call('rewind_10_seconds')], 'Rewind and 10 seconds select the fixed backward seek action.'),
  row('Skip forward 10 seconds', [call('skip_forward_10_seconds')], 'Forward and 10 seconds select the fixed forward seek action.'),
  row('Show MP3 files', [call('show_mp3_files')], 'MP3 is the explicit requested library category.'),
  row('Show original videos', [call('show_original_videos')], 'Original videos is the explicit requested library category.'),
  row('Show karaoke files', [call('show_karaoke_files_or_videos')], 'Karaoke is the explicit requested library category.'),
  row('Show all media', [call('show_all_media_files')], 'All media clears the category filter.'),
  row('Open the media library', [call('show_library_panel')], 'Open and media library select the library panel tool.'),
  row('Close the media library', [call('hide_media_library_panel')], 'Close and media library select the library panel tool.'),
  row('Show the graphic equalizer', [call('show_graphic_equalizer_panel')], 'Graphic equalizer identifies the equalizer panel.'),
  row('Close the graphic equalizer', [call('close_graphic_equalizer_panel')], 'Close and graphic equalizer select the close action.'),
  row('Close the performance monitor', [call('close_performance_monitor_panel')], 'Close and performance monitor select the monitor close action.'),
  row('Find Example Track Alpha', [call('search_library', { query: 'Example Track Alpha' })], 'The search query is the complete named span.'),
  row('Refresh the media library', [call('refresh_library')], 'Refresh requests a library refresh.'),
  row('Set volume to 35 percent', [call('set_volume', { volume: 35 })], '35 is the explicitly requested volume percentage.'),
  row('Mute playback', [call('mute_audio')], 'Mute requests silence.'),
  row('Unmute playback', [call('unmute_audio')], 'Unmute requests restoring sound.'),
  row('Load the Rock equalizer preset', [call('load_eq_preset', { preset: 'Rock' })], 'Rock is the explicit requested preset.'),
  row('Open the voice command panel', [call('set_panel', { section: 'voice', action: 'open' })], 'Voice command panel and open identify the panel action.')
];
const negatives = [
  'What is the weather tomorrow?',
  'Tell me a joke.',
  'Explain how a record player works.',
  'Schedule a meeting for next Tuesday.',
  'Write a shopping list.',
  'What is the capital of Brazil?'
].map(query => row(query, [], 'No Media Deck tool covers this request.'));

function assertNoConflictingTargets(rows, splitName) {
  const targetsByQuery = new Map();
  for (const value of rows) {
    const target = JSON.stringify(value.answers);
    const targets = targetsByQuery.get(value.query) || new Set();
    targets.add(target);
    targetsByQuery.set(value.query, targets);
  }
  const conflicts = [...targetsByQuery].filter(([, targets]) => targets.size > 1);
  if (conflicts.length) throw new Error(`${splitName} contains ${conflicts.length} prompts with conflicting targets.`);
}
function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter(value => {
    const key = `${value.query}\n${JSON.stringify(value.answers)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function dataFor(groupsForSplit, splitName) {
  const rows = [];
  for (const group of groupsForSplit) {
    const defaultForms = new Set();
    for (const item of group.items) {
      const forms = [item.title, ...item.aliases || []]
        .filter(value => normalize(value));
      for (const title of forms) {
        const formKey = `${normalize(item.artist)}|${normalize(title)}`;
        if (!defaultForms.has(formKey)) {
          defaultForms.add(formKey);
          pushVariants(rows, item, title, 'any');
        }
        pushVariants(rows, item, title, kindFormat(item.kind));
      }
    }
  }
  const supplemental = splitName === 'train' ? [...staticRows, ...negatives, ...staticRows, ...negatives] : [...staticRows, ...negatives];
  rows.push(...supplemental);
  assertNoConflictingTargets(rows, splitName);
  return splitName === 'train' ? rows : dedupeRows(rows);
}
function summaryFor(groupsForSplit, rows) {
  const kinds = { mp3: 0, original_mp4: 0, karaoke_mp4: 0 };
  for (const group of groupsForSplit) for (const item of group.items) kinds[item.kind]++;
  return { groups: groupsForSplit.length, files: Object.values(kinds).reduce((sum, count) => sum + count, 0), kinds, examples: rows.length };
}

await mkdir(outputDirectory, { recursive: true });
const summaries = {};
for (const [splitName, groupsForSplit] of Object.entries(splits)) {
  const rows = dataFor(groupsForSplit, splitName);
  await writeFile(path.join(outputDirectory, `${splitName}.jsonl`), rows.map(value => JSON.stringify(value)).join('\n') + '\n', 'utf8');
  summaries[splitName] = summaryFor(groupsForSplit, rows);
}
const groupAssignments = Object.fromEntries(Object.entries(splits).map(([name, values]) => [name, values.map(group => ({
  key: group.key,
  files: group.items.map(item => ({ id: item.id, artist: item.artist, title: item.title, kind: item.kind }))
}))]));
const manifest = {
  generatedAt: new Date().toISOString(),
  generator: 'spa/scripts/generate-needle-training-data.mjs',
  catalog: path.relative(root, catalogPath),
  tools: path.relative(root, toolsPath),
  seed,
  contract: {
    playback: 'A final literal MP3 maps to mp3. A final literal MP4 maps to mp4. Otherwise media_type is any.',
    grouping: 'Every item sharing normalized artist and title is assigned to exactly one split.'
  },
  summaries,
  groupAssignments
};
await writeFile(path.join(outputDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ output: outputDirectory, ...summaries }, null, 2));
