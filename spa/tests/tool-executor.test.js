import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCalls,executeCalls} from '../app/scripts/tool-executor.js';
const call=(name,args)=>({name,arguments:args});
test('allows grounded volume, preset, and dedicated panel calls',()=>{
 assert.equal(validateCalls([call('set_volume',{volume:35})],'Set volume to 35 percent')[0].arguments.volume,35);
 assert.equal(validateCalls([call('load_eq_preset',{preset:'Rock'})],'Load Rock EQ')[0].arguments.preset,'Rock');
 assert.equal(validateCalls([call('close_graphic_equalizer_panel',{})],'Close the Graphic Equalizer').length,1);
 assert.equal(validateCalls([call('close_performance_monitor_panel',{})],'Close the performance monitor').length,1);
});
test('rejects unknown tools, extra arguments, empty settings, invalid types and ungrounded values',()=>{
 for(const [calls,text] of [
 [[call('delete_files',{})],'delete files'],
 [[call('set_volume',{volume:35,path:'x'})],'volume 35'],
 [[call('set_volume',{})],'close equalizer'],
 [[call('set_volume',{volume:'35'})],'volume 35'],
 [[call('set_volume',{volume:101})],'volume 101'],
 [[call('set_volume',{volume:50})],'volume 35'],
 [[call('play_media',{title:'Invented'})],'play Example Track Alpha'],
 [[call('show_all_media_files',{})],'delete all files'],
 [[call('skip_forward_10_seconds',{})],'skip forward 30 seconds'],
 [[call('set_volume',[])],'volume 35']
 ])assert.throws(()=>validateCalls(calls,text));
});
test('validates Needle-selected seek, filter, search, and panel tools without remapping tools',()=>{
 assert.deepEqual(validateCalls([call('skip_forward_10_seconds',{})],'Skip forward 10 seconds'),[call('skip_forward_10_seconds',{})]);
 assert.deepEqual(validateCalls([call('rewind_10_seconds',{})],'Rewind 10 seconds'),[call('rewind_10_seconds',{})]);
 assert.deepEqual(validateCalls([call('show_karaoke_files_or_videos',{})],'Show karaoke videos'),[call('show_karaoke_files_or_videos',{})]);
 assert.deepEqual(validateCalls([call('search_library',{query:'Example Track Alpha'})],'Find Example Track Alpha'),[call('search_library',{query:'Example Track Alpha'})]);
 assert.deepEqual(validateCalls([call('show_library_panel',{})],'Show library'),[call('show_library_panel',{})]);
 assert.deepEqual(validateCalls([call('show_graphic_equalizer_panel',{})],'Show graphic equalizer'),[call('show_graphic_equalizer_panel',{})]);
 assert.throws(()=>validateCalls([call('search_library',{query:'karaoke videos'})],'delete karaoke videos'));
});
test('named and current-track playback cannot execute together',()=>{
 assert.throws(()=>validateCalls([call('control_playback',{action:'play'}),call('play_media',{title:'Example Track Alpha'})],'Play Example Track Alpha'));
});
test('preserves the beginning of an explicitly requested title',()=>{
 const transcript="Play Azure Horizon Example Artist's version";
 const title='Azure Horizon',artist='Example Artist';
 assert.deepEqual(validateCalls([call('play_media',{title,artist})],transcript),[call('play_media',{title,artist})]);
 assert.throws(()=>validateCalls([call('play_media',{title:"Horizon Example Artist's version"})],transcript),/omitted the beginning/);
});
test('requires Needle to preserve an explicitly requested playback format',()=>{
 const title='Example Artist Example Track';
 assert.deepEqual(validateCalls([call('play_media',{title,format:'original_mp4'})],'Play Example Artist Example Track original video'),
  [call('play_media',{title,format:'original_mp4'})]);
 assert.throws(()=>validateCalls([call('play_media',{title})],'Play Example Artist Example Track original video'),/requested media format/);
 assert.throws(()=>validateCalls([call('play_media',{title,format:'original_mp4'})],'Play Example Artist Example Track karaoke video'),/requested media format/);
 assert.throws(()=>validateCalls([call('play_media',{title,format:'any'})],'Play Example Artist Example Track MP3'),/requested media format/);
});
test('accepts an exact title-only playback request but rejects an invented title',()=>{
 const title='Example Ensemble Anthology';
 assert.deepEqual(validateCalls([call('play_media',{title})],title),[call('play_media',{title})]);
 assert.throws(()=>validateCalls([call('play_media',{title:'Ensemble Anthology'})],title));
});
test('ambiguous selection is presented and never played',async()=>{
 let played=false,shown=false;
 const result=await executeCalls([call('play_media',{title:'Example Track Alpha'})],{
  matchMedia:()=>({status:'ambiguous',candidates:[{id:'one'},{id:'two'}],message:'Choose a version'}),
  playMedia:()=>{played=true},showCandidates:()=>{shown=true}
 });
 assert.equal(played,false);assert.equal(shown,true);assert.deepEqual(result,['Choose a version']);
});
test('an approved automatic command selects the first deterministic ambiguous candidate',async()=>{
 let played='',shown=false;
 const result=await executeCalls([call('play_media',{title:'Example Track Alpha'})],{
  matchMedia:()=>({status:'ambiguous',candidates:[{id:'one',title:'Example Track Alpha'},{id:'two',title:'Example Track Alpha Karaoke'}],message:'Choose a version'}),
  playMedia:id=>{played=id},showCandidates:()=>{shown=true}
 },{allowAmbiguousMedia:true});
 assert.equal(played,'one');assert.equal(shown,false);assert.deepEqual(result,['Playback requested: Example Track Alpha']);
});
test('validates an entire batch before callers can execute any part',()=>{
 assert.throws(()=>validateCalls([call('set_volume',{volume:35}),call('unknown',{})],'volume 35'));
});
