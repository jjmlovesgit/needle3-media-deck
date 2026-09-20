const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  const external=[],errors=[];let workers=0;
  await context.route('**/*',route=>{
   const url=route.request().url();
   if(url.startsWith('http://127.0.0.1:8080/')||url.startsWith('blob:'))return route.continue();
   external.push(url);return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('worker',()=>workers++);
  await page.goto('http://127.0.0.1:8080');
  await page.waitForFunction(()=>document.querySelector('#commandState').textContent.includes('WASM READY'),null,{timeout:60000});
  const samples=[];
  async function run(command){
   await page.locator('#commandInput').fill(command);await page.locator('#commandRun').click();
   await page.waitForFunction(()=>!document.querySelector('#commandRun').disabled,null,{timeout:60000});
   const sample={command,result:await page.locator('#commandResult').textContent(),metrics:await page.locator('#routingMetrics').textContent()};
   samples.push(sample);return sample;
  }
  await run('Set volume to 35 percent');assert.equal(await page.locator('#media').evaluate(el=>el.volume),.35);
  await run('Show MP3 files');assert.equal(await page.locator('[data-filter="mp3"]').getAttribute('aria-pressed'),'true');
  await run('Show original videos');assert.equal(await page.locator('[data-filter="original_mp4"]').getAttribute('aria-pressed'),'true');
  await run('Hide the library');assert.equal(await page.locator('#libraryPanel').isHidden(),true);
  await run('Show the library');assert.equal(await page.locator('#libraryPanel').isVisible(),true);
  await run('Show karaoke videos');assert.equal(await page.locator('[data-filter="karaoke_mp4"]').getAttribute('aria-pressed'),'true');
  await run('Load the Rock EQ preset');assert.match(await page.locator('#eqPresetStatus').textContent(),/Rock loaded/);
  await run('Close the equalizer');assert.equal(await page.locator('#equalizerPanel').evaluate(el=>el.open),false);
  await run('Play Shape of My Heart');assert.match(await page.locator('#commandResult').textContent(),/choose|Choose/);
  assert(await page.locator('#media').evaluate(el=>el.paused));
  const before=await page.locator('#media').evaluate(el=>({src:el.currentSrc,volume:el.volume,paused:el.paused}));
  await run('Delete all files');
  assert.match(await page.locator('#commandResult').textContent(),/not grounded|No supported/);
  assert.deepEqual(await page.locator('#media').evaluate(el=>({src:el.currentSrc,volume:el.volume,paused:el.paused})),before);
  await run('Play Kryptonite Official Video');
  await page.waitForFunction(()=>document.querySelector('#media').currentTime>.1);
  const beforeSkip=await page.locator('#media').evaluate(el=>el.currentTime);
  await run('Skip forward 10 seconds');
  const afterSkip=await page.locator('#media').evaluate(el=>el.currentTime);
  assert(afterSkip>beforeSkip+9,'skip should advance the active media by ten seconds');
  await run('Rewind 10 seconds');
  assert(await page.locator('#media').evaluate((el,position)=>el.currentTime<position-9,afterSkip),'rewind should move the active media back ten seconds');
  await page.locator('#commandInput').fill('Pause playback');
  await page.locator('#commandRun').click();
  await page.waitForTimeout(50);
  assert.equal(await page.locator('#media').evaluate(el=>el.paused),true,'exact pause should not wait for inference');
  await page.waitForFunction(()=>!document.querySelector('#commandRun').disabled,null,{timeout:60000});
  samples.push({command:'Pause playback',result:await page.locator('#commandResult').textContent(),metrics:await page.locator('#routingMetrics').textContent()});
  const pausedAt=await page.locator('#media').evaluate(el=>el.currentTime);
  await page.waitForTimeout(650);
  assert.equal(await page.locator('#media').evaluate(el=>el.paused),true);
  assert(Math.abs(await page.locator('#media').evaluate(el=>el.currentTime)-pausedAt)<.05,'paused media timestamp must stop advancing');
  assert.equal(workers,1,'one persistent worker for all commands');
  await context.setOffline(true);await run('Set volume to 42 percent');
  assert.match(await page.locator('#commandResult').textContent(),/preset was not present/);
  assert.equal(await page.locator('#media').evaluate(el=>el.volume),.35);
  await run('Set volume to 35 percent');assert.match(await page.locator('#commandResult').textContent(),/Volume 35%/);
  await context.setOffline(false);
  await page.setViewportSize({width:390,height:900});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.TEST_ARTIFACTS_DIR)await page.screenshot({path:path.join(process.env.TEST_ARTIFACTS_DIR,'needle-integration.png'),fullPage:true});
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#commandState').textContent.includes('WASM READY'),null,{timeout:60000});
  await run('Set volume to 35 percent');assert.equal(await page.locator('#media').evaluate(el=>el.volume),.35);
  assert.equal(workers,2,'one new worker only on reload');
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,samples,externalRequests:external.length},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

