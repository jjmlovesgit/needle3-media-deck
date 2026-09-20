import test from 'node:test';
import assert from 'node:assert/strict';
import { inferMetadata, groupAlbums, normalizeMediaText } from '../app/scripts/metadata.js';
import { matchMedia } from '../app/scripts/matching.js';
import { UIState } from '../app/scripts/ui-state.js';
test('reference generic titles, numbered album tracks, and unknown artist', () => {
  const video = inferMetadata('Example Artist - Example Track Alpha_20260917_114941_abc/source.mp4');
  assert.equal(video.title,'Example Track Alpha'); assert.equal(video.artist,'Example Artist');
  const song = inferMetadata('Example Collection - Tracks/02 - Example Track Beta.mp3');
  assert.equal(song.track,2); assert.equal(song.title,'Example Track Beta'); assert.equal(song.album,'Example Collection');
  assert.equal(song.artist,''); assert.equal(song.metadataSource,'Filename / folder');
  assert.equal(inferMetadata('audio.mp3').title,'audio');
});
test('album groups preserve numerical track order without merging different directories', () => {
  const albums=groupAlbums([
    {id:'a',title:'Ten',album:'Album',albumKey:'one',track:10},
    {id:'b',title:'Two',album:'Album',albumKey:'one',track:2},
    {id:'c',title:'Other',album:'Album',albumKey:'two',track:1}
  ]);
  assert.equal(albums.length,2); assert.deepEqual(albums[0].tracks.map(x=>x.id),['b','a']);
});
const items=[
  {id:'1',title:'A.B. Signal',artist:'Example Artist',album:'Album A',kind:'mp3'},
  {id:'2',title:'A.B. Signal',artist:'Example Artist',album:'Album A',kind:'karaoke_mp4'},
  {id:'3',title:'A.B. Signal',artist:'Other Artist',album:'Album B',kind:'mp3'}
];
test('matching normalizes punctuation but preserves ambiguity and optional constraints', () => {
  assert.equal(normalizeMediaText('A.B. Signal'),'ab signal');
  assert.equal(matchMedia(items,{title:'Ab Signal'}).status,'ambiguous');
  assert.equal(matchMedia(items,{title:'Ab Signal',artist:'Example Artist',format:'mp3'}).candidates[0].id,'1');
  assert.equal(matchMedia(items,{title:'Ab Signal',album:'Album B'}).candidates[0].id,'3');
  assert.equal(matchMedia(items,{title:'Signal'}).status,'ambiguous');
  assert.equal(matchMedia(items,{title:'unknown'}).status,'none');
  assert.equal(matchMedia(items,{title:'Ab Signal',artist:'unknown'}).status,'none');
});
test('structured artist-title input resolves a redundant title-as-artist argument generically', () => {
  const media=[{id:'structured',title:'Twilight Beacon',artist:'Night Ensemble',album:'Example Album',kind:'mp3'}];
  assert.equal(matchMedia(media,{title:'Night Ensemble - Twilight Beacon',artist:'Twilight Beacon'}).candidates[0].id,'structured');
  assert.equal(matchMedia(media,{title:'Night Ensemble — Twilight Beacon',artist:'Night Ensemble'}).status,'match');
  assert.equal(matchMedia(media,{title:'Night Ensemble - Twilight Beacon',artist:'Different Artist'}).status,'none');
});
test('invalid inputs and unrelated words never produce a match', () => {
  for(const request of [{title:''},{title:'!!!'},{title:'Ab Signal',format:'exe'},{title:'Ab Signal',run:'code'}]) assert.equal(matchMedia(items,request).status,'invalid');
  assert.equal(matchMedia(items,{title:'delete all files'}).status,'none');
});
test('possessive version requests can match grounded title and artist metadata', () => {
  const media=[{id:'session',title:'Azure Horizon Example s Session',artist:'Example Artist',album:'',kind:'original_mp4'}];
  const result=matchMedia(media,{title:"Azure Horizon Example Artist's session"});
  assert.equal(result.status,'ambiguous');
  assert.equal(result.candidates[0].id,'session');
});
test('bounded metadata fallback ranks a truncated full album above its tracks', () => {
  const album='Example Ensemble Anthology Collectio';
  const media=[
    {id:'track',title:'Example Track Gamma',artist:'',album,kind:'mp3'},
    {id:'full',title:'Example Ensemble Anthology Collectio',artist:'Example Ensemble',album:'',kind:'mp3'}
  ];
  const result=matchMedia(media,{title:'Example Ensemble Anthology Collection Set'});
  assert.equal(result.status,'ambiguous');
  assert.equal(result.candidates[0].id,'full');
});
test('bounded metadata fallback prioritizes the preserved first title word', () => {
  const media=[
    {id:'other',title:'Other Official Example Video',artist:'Example Artist',album:'',kind:'mp3'},
    {id:'signal',title:'Signal Unofficial Example Video',artist:'Example Artist',album:'',kind:'original_mp4'}
  ];
  const result=matchMedia(media,{title:'signal official example video'});
  assert.equal(result.status,'ambiguous');
  assert.equal(result.candidates[0].id,'signal');
});
test('library search covers artist/album and sorting is deterministic', () => {
  const ui=new UIState(); ui.setQuery('other artist');
  assert.equal(ui.visible(items)[0].id,'3');
  ui.setQuery('album a'); assert.equal(ui.visible(items).length,2);
});
