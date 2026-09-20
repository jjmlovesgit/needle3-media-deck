const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   globalThis.__voiceTest={trackStopped:false,starts:0};
   const track={label:'Test microphone',stop(){globalThis.__voiceTest.trackStopped=true;}};
   Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>({getAudioTracks:()=>[track],getTracks:()=>[track]})});
   class FakeRecognition{
    static async available(){return'available';}
    static async install(){throw new Error('install should not run when pack is available');}
    start(inputTrack){if(inputTrack!==undefined)throw new Error('recognizer must use the standard no-argument start');if(!globalThis.__voiceTest.trackStopped)throw new Error('permission-probe track still owns the microphone');globalThis.__voiceTest.starts++;queueMicrotask(()=>{this.onstart?.();this.onaudiostart?.();});}
    stop(){this.onresult?.({results:[[{transcript:'Set volume to 35 percent'}]]});this.onaudioend?.();this.onend?.();}
    abort(){this.onend?.();}
   }
   Object.defineProperty(FakeRecognition.prototype,'processLocally',{value:false,writable:true});
   Object.defineProperty(globalThis,'SpeechRecognition',{configurable:true,value:FakeRecognition});
  });
  await page.goto('http://127.0.0.1:8080');
  await page.waitForFunction(()=>document.querySelector('#commandState').textContent.includes('WASM READY'),null,{timeout:60000});
  assert.equal(await page.locator('#pushToTalk').isDisabled(),false);
  await page.keyboard.down('Control');await page.keyboard.down('Space');
  await page.waitForFunction(()=>document.querySelector('#commandState').textContent.includes('RECORDING LOCALLY'));
  await page.keyboard.up('Space');await page.keyboard.up('Control');
  await page.waitForFunction(()=>document.querySelector('#commandResult').textContent.includes('Volume 35%'),null,{timeout:60000});
  assert.equal(await page.locator('#media').evaluate(element=>element.volume),.35);
  assert.deepEqual(await page.evaluate(()=>globalThis.__voiceTest),{trackStopped:true,starts:1});
  assert.equal(await page.locator('#wakewordToggle').isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,shortcut:'Ctrl+Space',transcript:'Set volume to 35 percent'}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
