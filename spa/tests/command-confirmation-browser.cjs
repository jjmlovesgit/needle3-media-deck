const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');

(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto('http://127.0.0.1:8080');
  await page.waitForFunction(()=>document.querySelector('#commandState').textContent.includes('WASM READY'),null,{timeout:60000});
  await page.locator('#commandSensitivity').fill('100');
  assert.equal(await page.locator('#commandSensitivityValue').textContent(),'100%');
  await page.locator('#commandInput').fill('Could you please list the MP3 audio files');
  await page.locator('#commandRun').click();
  await page.waitForFunction(()=>!document.querySelector('#commandRun').disabled,null,{timeout:60000});
  const thresholdState=await page.locator('#commandState').textContent();
  if(/CONFIRM COMMAND/.test(thresholdState)){
   assert.equal(await page.locator('[data-filter="mp3"]').getAttribute('aria-pressed'),'false');
   assert.equal(await page.locator('#commandConfirm').isEnabled(),true);
   await page.locator('#commandConfirm').click();
   await page.waitForFunction(()=>document.querySelector('#commandState').textContent.includes('CONFIRMED RESULT'));
  }else{
   assert.match(thresholdState,/LOCAL RESULT/);
   assert.match(await page.locator('#routingMetrics').textContent(),/confidence 100%/);
  }
  assert.equal(await page.locator('[data-filter="mp3"]').getAttribute('aria-pressed'),'true');

  await page.locator('#commandSensitivity').fill('0');
  await page.locator('#commandInput').fill('Show all media');
  await page.locator('#commandRun').click();
  await page.waitForFunction(()=>!document.querySelector('#commandRun').disabled,null,{timeout:60000});
  assert.match(await page.locator('#commandState').textContent(),/LOCAL RESULT/);
  assert.equal(await page.locator('[data-filter="all"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.evaluate(()=>localStorage.getItem('needle3.commandConfidenceThreshold')),'0');
  const libraryTitles=await page.locator('.library-item .library-title').allTextContents();
  const playableTitle=libraryTitles
   .filter(title=>libraryTitles.filter(candidate=>candidate===title).length===1)
   .sort((left,right)=>left.length-right.length)[0];
  assert(playableTitle,'The test library must contain at least one unique title.');
  await page.locator('#commandInput').fill('Play '+playableTitle);
  await page.locator('#commandRun').click();
  await page.waitForFunction(()=>!document.querySelector('#commandRun').disabled,null,{timeout:60000});
  assert.match(await page.locator('#commandState').textContent(),/LOCAL RESULT/);
  assert.doesNotMatch(await page.locator('#commandResult').textContent(),/choose a candidate/i);
  assert.notEqual(await page.locator('.track-name').textContent(),'Choose local media');
  console.log('confirmation threshold: threshold decision, automatic and ambiguous playback paths, and persistence passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
