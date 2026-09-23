import { validateCalls, executeCalls } from './tool-executor.js';
import { createApplication } from './application.js';
import { createBrowserMedia } from './media.js';
import { loadSharedLibrary } from './source-library.js';
import { groupAlbums, normalizeMediaText } from './metadata.js';
import { prepareAudio, startVisuals, stopVisuals, refreshMonitor, disposeAudio, setPreset } from './reference-console.js';
import { NeedleClient } from './needle-client.js';
import { ManualVoiceInput } from './manual-voice.js';
import { CommandConfirmationPolicy } from './command-confirmation.js';

const $ = id => document.getElementById(id);
const media = /** @type {HTMLVideoElement} */ ($('media'));
const basePort = createBrowserMedia(media);
const port = {...basePort, async play(){await prepareAudio();return basePort.play();}};
const app = createApplication(port);
const {player,library,ui} = app;
const read = (key,fallback='') => {try{return localStorage.getItem('needle3.'+key)??fallback;}catch{return fallback;}};
const save = (key,value) => {try{localStorage.setItem('needle3.'+key,String(value));}catch{}};
const confirmationPolicy=new CommandConfirmationPolicy({read,save});
const renderConfirmationThreshold=()=>{
 $('commandSensitivity').value=String(confirmationPolicy.threshold);
 $('commandSensitivityValue').textContent=confirmationPolicy.threshold+'%';
 $('commandSensitivityHelp').textContent='Commands below '+confirmationPolicy.threshold+'% wait for confirmation.';
};
renderConfirmationThreshold();
$('commandSensitivity').oninput=event=>{confirmationPolicy.setThreshold(event.currentTarget.value);renderConfirmationThreshold();};
const storedVolume=Number(read('volume','0.5'));
player.setVolume(Number.isFinite(storedVolume)?Math.max(0,Math.min(1,storedVolume)):0.5);
let muted=read('muted')==='true';media.muted=muted;
const filters=['all','albums','mp3','original_mp4','karaoke_mp4'];
if(filters.includes(read('filter')))ui.filter=read('filter');
ui.query=read('search');ui.sort=read('sort','title');
$('librarySearch').value=ui.query;$('librarySort').value=ui.sort;
const notice=document.createElement('p');notice.id='libraryNotice';notice.setAttribute('role','status');
$('libraryList').before(notice);
const kindLabel={mp3:'MP3',original_mp4:'ORIGINAL VIDEO',karaoke_mp4:'KARAOKE'};
const formatTime=value=>{const seconds=Math.floor(Number.isFinite(value)?value:0);return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');};
let metadataCatalogId='',metadataRevision='';

async function openMetadataEditor(item){
 const message=$('metadataMessage');message.className='';message.textContent='Loading catalog metadata…';
 try{
  const response=await fetch('/api/catalog/items/'+encodeURIComponent(item.catalogId));
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Metadata is unavailable.');
  const catalogItem=data.item;metadataCatalogId=catalogItem.id;metadataRevision=response.headers.get('ETag')||'';
  $('metadataHeading').textContent='Edit '+catalogItem.title;
  for(const field of ['Title','Artist','Album'])$('metadata'+field).value=catalogItem[field.toLowerCase()]||'';
  $('metadataKind').value=catalogItem.kind;$('metadataTrack').value=catalogItem.track??'';$('metadataYear').value=catalogItem.year??'';
  $('metadataAliases').value=(catalogItem.aliases||[]).join('\n');$('metadataPath').textContent=catalogItem.relativePath;
  const extension=String(catalogItem.extension||catalogItem.relativePath.split('.').pop()).toLowerCase();
  for(const option of $('metadataKind').options)option.disabled=extension==='mp3'?option.value!=='mp3':option.value==='mp3';
  message.textContent='Changes update catalog.json; the media file remains unchanged.';$('metadataDialog').showModal();$('metadataTitle').focus();
 }catch(error){notice.textContent=error.message;}
}

function renderLibrary(){
 const items=library.list(),albums=groupAlbums(items),list=$('libraryList');
 $('libraryCounts').textContent=items.length+' FILES · '+items.filter(x=>x.kind==='mp3').length+' MP3 · '+items.filter(x=>x.kind==='original_mp4').length+' ORIGINAL VIDEO · '+items.filter(x=>x.kind==='karaoke_mp4').length+' KARAOKE';
 $('libraryFilters').replaceChildren();
 for(const filter of filters){
  const button=document.createElement('button');button.type='button';button.dataset.filter=filter;
  const count=filter==='all'?items.length:filter==='albums'?albums.length:items.filter(x=>x.kind===filter).length;
  button.textContent=(filter==='all'?'ALL':filter==='albums'?'ALBUMS':kindLabel[filter])+' '+count;
  button.classList.toggle('active',ui.filter===filter);button.setAttribute('aria-pressed',String(ui.filter===filter));
  button.onclick=()=>{ui.setFilter(filter);save('filter',filter);renderLibrary();};$('libraryFilters').append(button);
 }
 list.replaceChildren();
 const visible=ui.visible(items);
 function row(title,meta,badge,action,id,album=false){
  const entry=document.createElement('div');entry.className='library-entry';entry.setAttribute('role','group');
  const button=document.createElement('button');button.type='button';button.className='library-item'+(album?' library-album':'');
  if(id){button.dataset.id=id;button.classList.toggle('selected',player.state.mediaId===id);}
  const copy=document.createElement('div'),name=document.createElement('div'),details=document.createElement('div'),tag=document.createElement('span');
  name.className='library-title';name.textContent=title;details.className='library-meta';details.textContent=meta;tag.className='library-badge';tag.textContent=badge;
  copy.append(name,details);button.append(copy,tag);button.onclick=action;entry.append(button);
  const item=id?library.get(id):null;
  if(item?.catalogId){entry.classList.add('has-edit');const edit=document.createElement('button');edit.type='button';edit.className='library-edit';edit.textContent='EDIT';edit.setAttribute('aria-label','Edit metadata for '+item.title);edit.onclick=()=>{void openMetadataEditor(item);};entry.append(edit);}
  list.append(entry);
 }
 if(ui.filter==='albums'&&!ui.albumId){
  for(const album of groupAlbums(visible))row(album.title,album.tracks.length+' tracks','ALBUM',()=>{ui.albumId=album.id;renderLibrary();},null,true);
 }else{
  if(ui.albumId)row('‹ ALL ALBUMS','Return to album list','BACK',()=>{ui.albumId='';renderLibrary();},null,true);
  for(const item of visible)row((ui.albumId&&item.track?String(item.track).padStart(2,'0')+' · ':'')+item.title,
    [item.artist,item.album].filter(Boolean).join(' · '),kindLabel[item.kind],()=>{void selectMedia(item.id,true);},item.id);
 }
 if(!list.children.length)notice.textContent='No media matches this view.';
}
async function selectMedia(id,play=false){
 const item=library.get(id);if(!item){notice.textContent='This media is no longer available. Refresh the library.';return;}
 document.body.classList.toggle('audio',item.kind==='mp3');document.body.classList.toggle('video',item.kind!=='mp3');
 if(player.state.mediaId!==id)player.select(item);
 document.querySelector('.track-name').textContent=item.title;
 document.querySelector('.file-name').textContent=item.relativePath?.split(/[\\/]/).pop()||item.file.name||item.title;
 if(item.source==='shared')save('selection',item.id);
 refreshMonitor();renderLibrary();
 if(play)await player.play();
}
let loading=false;
async function refreshLibrary(refresh=false){
 if(loading)return;loading=true;$('libraryRefresh').disabled=true;notice.textContent=refresh?'SCANNING LOCAL LIBRARY…':'LOADING LOCAL LIBRARY…';
 try{
  const result=await loadSharedLibrary(refresh);library.replaceShared(result.items);
  notice.textContent=result.items.length+' local files · read-only shared source'+(result.skipped?' · '+result.skipped+' excluded entries':'');
  if(player.state.mediaId&&!library.get(player.state.mediaId))player.stop();
  if(!player.state.mediaId){const selected=library.get(read('selection'))||result.items[0];if(selected)await selectMedia(selected.id);}
  renderLibrary();
 }catch(error){notice.textContent=error.message+' You can still open a local file.';}
 finally{loading=false;$('libraryRefresh').disabled=false;}
}
$('libraryRefresh').onclick=()=>{void refreshLibrary(true);};
$('librarySearch').oninput=()=>{ui.setQuery($('librarySearch').value);save('search',ui.query);renderLibrary();};
$('librarySort').onchange=()=>{ui.sort=$('librarySort').value;save('sort',ui.sort);renderLibrary();};
// Preserve the reference sort control; technical sorts wait for actual metadata.
for(const option of $('librarySort').options)if(['bitrate','duration'].includes(option.value)){option.disabled=true;option.textContent+=' (metadata pending)';}
if(!['title','newest'].includes(ui.sort)){ui.sort='title';$('librarySort').value='title';}
$('chooseFiles').onclick=()=>$('files').click();
$('files').onchange=()=>{
 const result=library.add($('files').files||[]);$('files').value='';
 notice.textContent=result.added.length+' local files added'+(result.rejected?' · '+result.rejected+' unsupported files skipped':'');
 if(result.added[0])void selectMedia(result.added[0].id);renderLibrary();
};
$('metadataClose').onclick=$('metadataCancel').onclick=()=>$('metadataDialog').close();
$('metadataForm').onsubmit=async event=>{
 event.preventDefault();const button=$('metadataSave'),message=$('metadataMessage'),nullable=id=>$(id).value===''?null:Number($(id).value);
 const update={title:$('metadataTitle').value,artist:$('metadataArtist').value,album:$('metadataAlbum').value,kind:$('metadataKind').value,
  track:nullable('metadataTrack'),year:nullable('metadataYear'),aliases:$('metadataAliases').value.split(/\r?\n/)};
 button.disabled=true;message.className='';message.textContent='Saving metadata…';
 try{
  const response=await fetch('/api/catalog/items/'+encodeURIComponent(metadataCatalogId),{method:'PATCH',headers:{'Content-Type':'application/json','If-Match':metadataRevision},body:JSON.stringify(update)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Metadata save failed.');
  $('metadataDialog').close();await refreshLibrary(true);if(player.state.mediaId)await selectMedia(player.state.mediaId);notice.textContent='Metadata saved for '+data.item.title+'.';
 }catch(error){message.textContent=error.message;message.className='error';}finally{button.disabled=false;}
};
$('play').onclick=()=>player.toggle();$('stop').onclick=()=>player.stop();
$('back').onclick=()=>player.skip(-10);$('forward').onclick=()=>player.skip(10);
$('stage').onclick=()=>player.toggle();$('stage').tabIndex=0;$('stage').setAttribute('role','button');$('stage').setAttribute('aria-label','Pause or resume media');
$('stage').onkeydown=event=>{if(event.target===$('stage')&&['Enter',' '].includes(event.key)){event.preventDefault();player.toggle();}};
$('seek').oninput=()=>player.seek(player.state.duration*Number($('seek').value)/1000);
$('volume').oninput=()=>{muted=false;media.muted=false;save('muted',false);player.setVolume(Number($('volume').value));};
$('mute').onclick=()=>{muted=!muted;media.muted=muted;save('muted',muted);renderVolume();};
function renderVolume(){$('volume').value=String(player.state.volume);$('mute').textContent=muted?'MUTE':Math.round(player.state.volume*100)+'%';}
$('full').onclick=()=>{void $('stage').requestFullscreen().catch(()=>{notice.textContent='Fullscreen is unavailable in this browser.';});};
for(const id of ['monitorPanel','commandPanel','equalizerPanel','libraryPanel']){
 const panel=$(id),stored=read('panel.'+id);if(stored)panel.open=stored==='true';
 panel.addEventListener('toggle',()=>{save('panel.'+id,panel.open);refreshMonitor();});
}
let lastSavedVolume;let lastMarkedId;
player.subscribe(state=>{
 const enabled=Boolean(state.mediaId)&&state.status!=='error';
 for(const id of ['play','stop','back','forward','seek'])$(id).disabled=!enabled;
 $('elapsed').textContent=formatTime(state.position);$('duration').textContent=formatTime(state.duration);
 $('seek').value=state.duration?String(state.position/state.duration*1000):'0';
 $('play').textContent=state.status==='playing'?'❚❚':'▶';$('play').setAttribute('aria-label',state.status==='playing'?'Pause':'Play');
 $('mode').textContent=state.error||({'empty':'TRANSPORT READY','loading':'LOADING MEDIA','playing':'PLAYBACK ACTIVE','stopped':'STOPPED','ended':'PLAYBACK ENDED'}[state.status]||'TRANSPORT READY');
 document.body.classList.toggle('playing',state.status==='playing');renderVolume();
 if(state.status==='playing')startVisuals();else stopVisuals();
 if(lastSavedVolume!==state.volume){save('volume',state.volume);lastSavedVolume=state.volume;}
 if(lastMarkedId!==state.mediaId){lastMarkedId=state.mediaId;document.querySelectorAll('[data-id]').forEach(row=>row.classList.toggle('selected',row.dataset.id===state.mediaId));}
});
media.addEventListener('loadedmetadata',refreshMonitor);
media.addEventListener('error',()=>{notice.textContent='This file could not be decoded. Select another local file.';});
const experimentalNeedleModel='needle3-media-deck-corrected-smoke.cact';
const modelSearchParams=new URLSearchParams(location.search);
const requestedNeedleModel=modelSearchParams.get('needle-model')||undefined;
const usingExperimentalNeedleModel=requestedNeedleModel===experimentalNeedleModel;
$('experimentalModelToggle').checked=usingExperimentalNeedleModel;
$('experimentalModelToggle').onchange=event=>{
 const next=new URL(location.href);
 if(event.currentTarget.checked)next.searchParams.set('needle-model',experimentalNeedleModel);
 else next.searchParams.delete('needle-model');
 location.assign(next.toString());
};
const needle=new NeedleClient();
let voiceMutedBefore=false;
const voice=new ManualVoiceInput({
 onState:value=>$('commandState').textContent=value,
 onMessage:value=>$('commandResult').textContent=value,
 onInterim:value=>$('commandInput').value=value,
 onRecording:active=>{if(active)$('pushToTalk').classList.remove('arming');$('pushToTalk').classList.toggle('recording',active);$('pushToTalk').setAttribute('aria-pressed',String(active));},
 onCapture:active=>{if(active){voiceMutedBefore=media.muted;media.muted=true;$('pushToTalk').classList.add('arming');}else{media.muted=voiceMutedBefore;$('pushToTalk').classList.remove('arming','recording');$('pushToTalk').setAttribute('aria-pressed','false');}},
 onTranscript:async transcript=>{$('commandInput').value=transcript;await runTypedCommand();}
});
for(const id of ['commandInput','commandRun','pushToTalk','wakewordToggle'])$(id).disabled=true;
$('commandState').textContent='NEEDLE 3 · WASM ASSETS PENDING';
$('wakewordToggle').checked=false;
$('wakewordMode').textContent='LOCAL VOICE · NOT CONNECTED';
$('wakewordStatus').textContent='NOT LOADED';
$('commandInput').placeholder='Needle 3 WASM runtime and model assets pending';
$('commandResult').textContent='WASM worker boundary is active. Voice and inference are not connected; no microphone is opened.';

void refreshLibrary();
window.addEventListener('pagehide',event=>{if(!event.persisted){voice.dispose();player.dispose();disposeAudio();needle.dispose();}});


const routingMetrics=document.createElement('div');routingMetrics.id='routingMetrics';routingMetrics.className='command-result';
const callDetails=document.createElement('pre');callDetails.id='validatedCalls';callDetails.className='command-result';callDetails.style.whiteSpace='pre-wrap';callDetails.style.overflowWrap='anywhere';
$('commandResult').after(routingMetrics,callDetails);
let routing=false,needleStatus=null;
let pendingCommand=null;
const commandAPI={
 matchMedia:request=>app.matchMedia(request),
 playMedia:async id=>{await selectMedia(id,true);if(player.state.error)throw new Error(player.state.error);},
 showCandidates:items=>{
  $('libraryPanel').hidden=false;$('libraryPanel').open=true;
  ui.filter='all';ui.query='';ui.albumId='';$('librarySearch').value='';
  renderLibrary();
  const ids=new Set(items.map(item=>item.id));
  for(const row of $('libraryList').querySelectorAll('[data-id]'))row.hidden=!ids.has(row.dataset.id);
 },
 control:async action=>{
  if(!player.state.mediaId)throw new Error('Select a local track first.');
  if(action==='play')await player.play();
  else if(action==='pause'){
    if(!player.pause())throw new Error('Playback did not pause. Try the transport Pause button.');
   const pausedAt=media.currentTime;
   await new Promise(resolve=>setTimeout(resolve,120));
   if(!media.paused||Math.abs(media.currentTime-pausedAt)>.05)throw new Error('Playback did not pause. Try the transport Pause button.');
  }
  else if(action==='stop')player.stop();
  else if(action==='rewind_10')player.skip(-10);
  else if(action==='skip_10')player.skip(10);
  else {
   const items=ui.visible(library.list()),index=items.findIndex(item=>item.id===player.state.mediaId);
   const next=items[index+(action==='next'?1:-1)];
   if(index<0||!next)throw new Error('No '+action+' track in the current view.');
   await selectMedia(next.id,true);
  }
  if(player.state.error)throw new Error(player.state.error);
 },
 setPreset,
 setVolume:value=>{muted=false;media.muted=false;save('muted',false);player.setVolume(value);},
 adjustVolume:action=>{
  if(action==='mute'||action==='unmute'){
   muted=action==='mute';media.muted=muted;save('muted',muted);renderVolume();return;
  }
  muted=false;media.muted=false;save('muted',false);
  player.setVolume(player.state.volume+(action==='increase'?.1:-.1));renderVolume();
 },
 manageLibrary:async args=>{
  $('libraryPanel').hidden=false;$('libraryPanel').open=true;
  if(args.action==='refresh')await refreshLibrary(true);
  else if(args.action==='filter')ui.setFilter(args.media_type);
  else if(args.action==='search')ui.setQuery(args.query);
  else {ui.setFilter('all');ui.setQuery('');}
  $('librarySearch').value=ui.query;save('search',ui.query);save('filter',ui.filter);renderLibrary();
 },
 manageInterface:({section,action})=>{
  const id={performance_monitor:'monitorPanel',equalizer:'equalizerPanel',library:'libraryPanel',voice:'commandPanel'}[section];
  const panel=$(id);if(!panel)throw new Error('That section is unavailable.');
  panel.hidden=false;panel.open=['show','open'].includes(action);
  refreshMonitor();
 }
};
if(new URLSearchParams(location.search).has('catalog-regression'))Object.defineProperty(globalThis,'__mediaDeckCatalogRegression',{
 value:{matchMedia:request=>app.matchMedia(request),librarySize:()=>app.library.list().length},configurable:true
});
function displayMetrics(metrics,result={}){
 const confidence=typeof result.confidence==='number'?Math.round(result.confidence*100)+'%':'—';
 const tps=value=>Number.isFinite(value)&&value>=0?value.toFixed(1):'—';
 const peak=Number.isFinite(result.peak_ram_mb)&&result.peak_ram_mb>0?result.peak_ram_mb.toFixed(1)+' MB':'unavailable';
 routingMetrics.textContent='Needle 3 · '+metrics.depth+' layers · '+(metrics.modelBytes/1048576).toFixed(1)+' MiB model · init '+metrics.initializationMs+' ms'+
  (metrics.routingMs!==undefined?' · route '+metrics.routingMs+' ms'+(metrics.retried?' · bounded retry':'')+' · confidence '+confidence+' · prefill '+tps(result.prefill_tps)+' tok/s · decode '+tps(result.decode_tps)+' tok/s':'')+
  ' · WASM allocation '+(metrics.wasmMemoryBytes/1048576).toFixed(1)+' MiB · reported peak '+peak;
}
async function runTypedCommand(){
 const query=$('commandInput').value.trim();if(!query||routing||!needleStatus?.ready)return;
 pendingCommand=null;$('commandConfirm').disabled=true;
 routing=true;$('commandRun').disabled=true;$('commandInput').disabled=true;
 $('commandState').textContent='NEEDLE 3 · ROUTING LOCALLY';$('commandResult').textContent='Routing on this device…';callDetails.textContent='';
 try{
  if(/\b(play|resume|continue)\b/i.test(query))await prepareAudio();
  const response=await needle.request('route',query);
  displayMetrics(response.metrics,response.result);
  const result=response.result;
  if(!result.success)throw new Error(result.error||result.reason||'Needle refused this request.');
  if(!result.function_calls?.length){$('commandState').textContent='NEEDLE 3 · NO ACTION';$('commandResult').textContent='No supported action matched. Nothing was changed.';return;}

  callDetails.textContent='PROPOSED BY NEEDLE\n'+JSON.stringify(result.function_calls,null,2);
  const calls=validateCalls(result.function_calls,query);
  callDetails.textContent='VALIDATED BY APPLICATION\n'+JSON.stringify(calls,null,2);
  const confidence=typeof result.confidence==='number'?result.confidence:undefined;
  if(confirmationPolicy.requiresConfirmation(confidence)){
   pendingCommand={calls};
   callDetails.textContent='AWAITING CONFIRMATION\n'+JSON.stringify(calls,null,2);
   const percent=typeof confidence==='number'?Math.round(confidence*100)+'%':'unavailable';
   $('commandState').textContent='NEEDLE 3 · CONFIRM COMMAND';
   $('commandResult').textContent='Needle confidence '+percent+' is below the '+confirmationPolicy.threshold+'% threshold. Review and confirm to execute.';
   $('commandConfirm').disabled=false;
   return;
  }
  callDetails.textContent=JSON.stringify(calls,null,2);
  const results=await executeCalls(calls,commandAPI,{allowAmbiguousMedia:true});
  $('commandState').textContent='NEEDLE 3 · LOCAL RESULT';$('commandResult').textContent=results.join(' · ');
 }catch(error){$('commandState').textContent='NEEDLE 3 · CHECK RESULT';$('commandResult').textContent=error.message;}
 finally{routing=false;$('commandRun').disabled=false;$('commandInput').disabled=false;}
}
async function confirmPendingCommand(){
 if(routing||!pendingCommand)return;
 const {calls}=pendingCommand;pendingCommand=null;routing=true;
 $('commandConfirm').disabled=true;$('commandRun').disabled=true;$('commandInput').disabled=true;
 $('commandState').textContent='NEEDLE 3 · EXECUTING CONFIRMED';
 try{
  callDetails.textContent=JSON.stringify(calls,null,2);
  const results=await executeCalls(calls,commandAPI,{allowAmbiguousMedia:true});
  $('commandState').textContent='NEEDLE 3 · CONFIRMED RESULT';$('commandResult').textContent=results.join(' · ');
 }catch(error){$('commandState').textContent='NEEDLE 3 · CHECK RESULT';$('commandResult').textContent=error.message;}
 finally{routing=false;$('commandRun').disabled=false;$('commandInput').disabled=false;}
}
$('commandRun').onclick=()=>{void runTypedCommand();};
$('commandConfirm').onclick=()=>{void confirmPendingCommand();};
$('commandInput').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();void runTypedCommand();}};
const beginManualVoice=()=>{if(!needleStatus?.ready||routing)return;void voice.begin();};
const endManualVoice=()=>voice.end();
$('pushToTalk').onpointerdown=event=>{event.preventDefault();$('pushToTalk').setPointerCapture(event.pointerId);beginManualVoice();};
$('pushToTalk').onpointerup=event=>{event.preventDefault();endManualVoice();};
$('pushToTalk').onpointercancel=endManualVoice;
$('pushToTalk').oncontextmenu=event=>event.preventDefault();
$('pushToTalk').onkeydown=event=>{if(event.key==='Enter'&&!event.repeat){event.preventDefault();beginManualVoice();}};
$('pushToTalk').onkeyup=event=>{if(event.key==='Enter'){event.preventDefault();endManualVoice();}};
let voiceSpaceHeld=false;
document.addEventListener('keydown',event=>{if(event.code!=='Space'||!event.ctrlKey||event.repeat||voiceSpaceHeld)return;event.preventDefault();event.stopPropagation();voiceSpaceHeld=true;beginManualVoice();},true);
document.addEventListener('keyup',event=>{if(event.code!=='Space'||!voiceSpaceHeld)return;event.preventDefault();event.stopPropagation();voiceSpaceHeld=false;endManualVoice();},true);
window.addEventListener('blur',()=>{if(voiceSpaceHeld){voiceSpaceHeld=false;endManualVoice();}});
$('commandState').textContent=usingExperimentalNeedleModel?'NEEDLE 3 · LOADING 5-EPOCH TEST':'NEEDLE 3 · LOADING LOCAL WASM';
$('commandResult').textContent='Verifying and loading the local model. No microphone capture.';
void needle.request('status',{modelAsset:requestedNeedleModel}).then(status=>{
 needleStatus=status;displayMetrics(status);
 $('commandInput').disabled=false;$('commandRun').disabled=false;
 $('pushToTalk').disabled=!voice.supported;
 $('commandInput').placeholder='Try: Set volume to 35 percent';
 $('commandState').textContent=usingExperimentalNeedleModel?'NEEDLE 3 · 5-EPOCH TEST READY':'NEEDLE 3 · WASM READY';
 $('wakewordMode').textContent=voice.supported?'LOCAL VOICE · MANUAL PTT':'LOCAL VOICE · UNAVAILABLE';
 $('wakewordStatus').textContent=voice.supported?'PTT READY':'LOCAL STT UNAVAILABLE';
 $('commandResult').textContent=voice.supported?'Type a command, or hold the microphone button or Ctrl+Space to speak locally.':'Type a command and press Run. This browser does not expose local speech recognition.';
}).catch(error=>{$('commandState').textContent='NEEDLE 3 · LOAD FAILED';$('commandResult').textContent=error.message;});
