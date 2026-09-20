import test from 'node:test';
import assert from 'node:assert/strict';
import { inferMetadata, groupAlbums, normalizeMediaText } from '../app/scripts/metadata.js';
import { matchMedia } from '../app/scripts/matching.js';
import { UIState } from '../app/scripts/ui-state.js';
test('reference generic titles, numbered album tracks, and unknown artist', () => {
  const video = inferMetadata('The Doors - Riders on the Storm_20260917_114941_abc/source.mp4');
  assert.equal(video.title,'Riders on the Storm'); assert.equal(video.artist,'The Doors');
  const song = inferMetadata('Fleetwood Mac - Tracks/02 - Dreams.mp3');
  assert.equal(song.track,2); assert.equal(song.title,'Dreams'); assert.equal(song.album,'Fleetwood Mac');
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
  {id:'1',title:'L.A. Woman',artist:'The Doors',album:'Album A',kind:'mp3'},
  {id:'2',title:'L.A. Woman',artist:'The Doors',album:'Album A',kind:'karaoke_mp4'},
  {id:'3',title:'L.A. Woman',artist:'Other Artist',album:'Album B',kind:'mp3'}
];
test('matching normalizes punctuation but preserves ambiguity and optional constraints', () => {
  assert.equal(normalizeMediaText('L.A. Woman'),'la woman');
  assert.equal(matchMedia(items,{title:'La Woman'}).status,'ambiguous');
  assert.equal(matchMedia(items,{title:'La Woman',artist:'The Doors',format:'mp3'}).candidates[0].id,'1');
  assert.equal(matchMedia(items,{title:'La Woman',album:'Album B'}).candidates[0].id,'3');
  assert.equal(matchMedia(items,{title:'Woman'}).status,'ambiguous');
  assert.equal(matchMedia(items,{title:'unknown'}).status,'none');
  assert.equal(matchMedia(items,{title:'La Woman',artist:'unknown'}).status,'none');
});
test('invalid inputs and unrelated words never produce a match', () => {
  for(const request of [{title:''},{title:'!!!'},{title:'La Woman',format:'exe'},{title:'La Woman',run:'code'}]) assert.equal(matchMedia(items,request).status,'invalid');
  assert.equal(matchMedia(items,{title:'delete all files'}).status,'none');
});
test('possessive version requests can match grounded title and artist metadata', () => {
  const media=[{id:'bayou',title:'Born On The Bayou John s Version',artist:'John Fogerty',album:'',kind:'original_mp4'}];
  const result=matchMedia(media,{title:"Born on the Bayou John Fogerty's version"});
  assert.equal(result.status,'ambiguous');
  assert.equal(result.candidates[0].id,'bayou');
});
test('library search covers artist/album and sorting is deterministic', () => {
  const ui=new UIState(); ui.setQuery('other artist');
  assert.equal(ui.visible(items)[0].id,'3');
  ui.setQuery('album a'); assert.equal(ui.visible(items).length,2);
});
