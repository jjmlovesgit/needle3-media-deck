import createNeedle from '../vendor/needle3/needle-browser.mjs';
let engine=null,initializing=null,info=null,modelPointer=0;
const vendor=new URL('../vendor/needle3/',import.meta.url);
const validModelAsset=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]*\.cact$/.test(value);
const ROUTING_CONTRACT='Route each explicit local media-player request using the provided tool names, descriptions, and schemas. Distinguish named playback, current transport, media-category filtering, library search, panel visibility, volume, and equalizer operations. A named panel or interface container always requires its dedicated panel tool; an action verb plus the exact panel name is a complete panel request and needs no courtesy words, extra object, or argument. A media-category filter requires an explicitly stated category such as all, MP3, original video, or karaoke. The word media by itself is not a category filter. Every named playback call must set the required media_type: mp3 only for a final MP3 or audio, mp4 only for a final MP4 or video, and any for every request without one of those final format phrases. Do not infer a format from words in a title or catalog name; all such words remain in title. Karaoke and original-video labels are library classifications, not separate playback formats. Use set_volume with the stated number for an explicit percentage, mute_audio only for mute, and unmute_audio only for unmute. Preserve forward versus backward transport direction. Copy every free-text argument as one complete verbatim span from the user input, preserving its first and last media-name words. Include optional arguments only when explicitly stated. Never invent or rewrite argument values. Return no calls for unsupported requests.';
async function checkedFile(manifest,name){
 const entry=manifest.files.find(x=>x.name===name);
 const response=await fetch(new URL(name,vendor));
 if(!response.ok)throw new Error('Missing local Needle asset: '+name);
 const bytes=await response.arrayBuffer();
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
 if(!entry||hash!==entry.sha256||bytes.byteLength!==entry.bytes)throw new Error('Needle asset verification failed: '+name);
 return bytes;
}
async function initialize(requestedModel){
 if(engine)return info;if(initializing)return initializing;
 initializing=(async()=>{
  const start=performance.now();
  const manifest=await (await fetch(new URL('manifest.json',vendor))).json();
  const modelAsset=validModelAsset(requestedModel)?requestedModel:'needle3.cact';
  const wasm=await checkedFile(manifest,'needle.wasm');
  const model=await checkedFile(manifest,modelAsset);
  const runtime=await createNeedle({wasmBinary:wasm,print:()=>{},printErr:()=>{}});
  modelPointer=runtime._malloc(model.byteLength);
  if(!modelPointer)throw new Error('Not enough WASM memory for Needle model');
  runtime.HEAPU8.set(new Uint8Array(model),modelPointer);
  const loaded=runtime._needle_load(modelPointer,BigInt(model.byteLength));
  if(loaded<0)throw new Error('Needle model load failed ('+loaded+')');
  const tools=await (await fetch(new URL('../media-tools.json',import.meta.url))).json();
  const prefix=runtime.ccall('needle_init','number',['string','string','string'],[
    ROUTING_CONTRACT,
    JSON.stringify(tools),'']);
  if(prefix<0)throw new Error('Needle tool initialization failed; schema may exceed model context ('+prefix+')');
  engine=runtime;
  info={generation:3,depth:manifest.depth,revision:manifest.revision,modelAsset,modelBytes:model.byteLength,ready:true,initializationMs:Math.round(performance.now()-start),prefixTokens:prefix,wasmMemoryBytes:engine.HEAPU8.byteLength};
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
   const result=data.type==='status'?await initialize(data.payload?.modelAsset):data.type==='route'?await route(data.payload):(()=>{throw new Error('Unknown worker request');})();
   self.postMessage({id:data.id,result});
  }catch(error){self.postMessage({id:data.id,error:error.message||'Needle runtime failed'});}
 });
});
