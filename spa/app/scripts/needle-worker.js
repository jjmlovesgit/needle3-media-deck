import createNeedle from '../vendor/needle3/needle-browser.mjs';
let engine=null,initializing=null,info=null,modelPointer=0;
const vendor=new URL('../vendor/needle3/',import.meta.url);
async function checkedFile(manifest,name){
 const entry=manifest.files.find(x=>x.name===name);
 const response=await fetch(new URL(name,vendor));
 if(!response.ok)throw new Error('Missing local Needle asset: '+name);
 const bytes=await response.arrayBuffer();
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
 if(!entry||hash!==entry.sha256||bytes.byteLength!==entry.bytes)throw new Error('Needle asset verification failed: '+name);
 return bytes;
}
async function initialize(){
 if(engine)return info;if(initializing)return initializing;
 initializing=(async()=>{
  const start=performance.now();
  const manifest=await (await fetch(new URL('manifest.json',vendor))).json();
  const wasm=await checkedFile(manifest,'needle.wasm');
  const model=await checkedFile(manifest,'needle3.cact');
  const runtime=await createNeedle({wasmBinary:wasm,print:()=>{},printErr:()=>{}});
  modelPointer=runtime._malloc(model.byteLength);
  if(!modelPointer)throw new Error('Not enough WASM memory for Needle model');
  runtime.HEAPU8.set(new Uint8Array(model),modelPointer);
  const loaded=runtime._needle_load(modelPointer,BigInt(model.byteLength));
  if(loaded<0)throw new Error('Needle model load failed ('+loaded+')');
  const tools=await (await fetch(new URL('../media-tools.json',import.meta.url))).json();
  const prefix=runtime.ccall('needle_init','number',['string','string','string'],[
    'Media Deck local media player. Route only explicit requests. Named playback uses play_media. Preserve the beginning of every title. A trailing possessive version phrase is an artist qualifier: Play Born on the Bayou John Fogerty\'s version means title Born on the Bayou and artist John Fogerty, never title Bayou. Almost Cut My Hair must stay Almost Cut My Hair, never Most Cut My Hair. Bare transport uses control_playback. Volume changes use only set_volume; EQ changes use only load_eq_preset. Never add an EQ preset to a volume request. Show or open the Graphic Equalizer uses show_graphic_equalizer_panel; close the Graphic Equalizer uses close_graphic_equalizer_panel. Close the performance monitor uses close_performance_monitor_panel. Skip forward 10 seconds uses only skip_forward_10_seconds. Rewind or go back 10 seconds uses only rewind_back_10_seconds. Show MP3 files uses only show_mp3_files. Show original videos uses only show_original_videos. Show karaoke files uses only show_karaoke_files_or_videos. Show all media uses only show_all_media. Those four requests filter media and never open the library panel. Show the library uses open_media_library_panel. Hide the library uses hide_media_library_panel. Never invent artist, album, query, value, or action. Unsupported requests return no calls.',
    JSON.stringify(tools),'']);
  if(prefix<0)throw new Error('Needle tool initialization failed; schema may exceed model context ('+prefix+')');
  engine=runtime;
  info={generation:3,depth:manifest.depth,revision:manifest.revision,modelBytes:model.byteLength,ready:true,initializationMs:Math.round(performance.now()-start),prefixTokens:prefix,wasmMemoryBytes:engine.HEAPU8.byteLength};
  return info;
 })();
 try{return await initializing;}catch(error){initializing=null;throw error;}
}
async function route(text){
 if(typeof text!=='string'||!text.trim()||text.length>500)throw new Error('Enter a command of 1–500 characters.');
 await initialize();
 const capacity=32768,out=engine._malloc(capacity),start=performance.now();
 try{
  const complete=maxTokens=>{
   // Reset per-command history/KV state; keep the initialized model/tool catalogue.
   engine._needle_reset();
   const written=engine.ccall('needle_complete','number',['string','number','number','number'],[text,maxTokens,out,capacity]);
   if(written<0||written>=capacity)throw new Error('Needle completion failed ('+written+')');
   return JSON.parse(engine.UTF8ToString(out));
  };
  let result=complete(256),retried=false;
  const failure=String(result.error||result.reason||'');
  if(!result.success&&/tool call truncated|token budget exhausted/i.test(failure)){
   retried=true;result=complete(512);
  }
  return {result,metrics:{...info,routingMs:Math.round(performance.now()-start),retried,wasmMemoryBytes:engine.HEAPU8.byteLength}};
 }finally{engine._free(out);}
}
let queue=Promise.resolve();
self.addEventListener('message',({data})=>{
 if(!data||!Number.isSafeInteger(data.id))return;
 queue=queue.then(async()=>{
  try{
   const result=data.type==='status'?await initialize():data.type==='route'?await route(data.payload):(()=>{throw new Error('Unknown worker request');})();
   self.postMessage({id:data.id,result});
  }catch(error){self.postMessage({id:data.id,error:error.message||'Needle runtime failed'});}
 });
});
