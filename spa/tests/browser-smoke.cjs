const path=require('node:path');const artifacts=process.env.TEST_ARTIFACTS_DIR;if(!artifacts)throw new Error('Set TEST_ARTIFACTS_DIR');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});
 try {
  const p=await b.newPage({viewport:{width:1440,height:1100}});const errors=[],requests=[];let workers=0;
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>requests.push(r.url()));p.on('worker',()=>workers++);
  await p.goto('http://127.0.0.1:8080');
  await p.waitForFunction(()=>document.querySelector('#libraryCounts').textContent.includes(' FILES · '));
  await p.locator('#libraryPanel summary').click();
  await p.locator('#equalizerPanel summary').click();
  const manifest=await (await p.request.get('http://127.0.0.1:8080/api/library')).json();
  const audio=manifest.items.find(x=>x.kind==='mp3');const video=manifest.items.find(x=>x.kind==='original_mp4');
  await p.locator('[data-id="'+audio.id+'"]').click();
  await p.waitForFunction(()=>document.querySelector('#media').currentTime>1);
  assert.equal(await p.locator('#media').count(),1);
  for(const item of manifest.items.filter(x=>x.kind==='mp3').slice(0,3)){
   await p.locator('[data-id="'+item.id+'"]').click();
   await p.waitForFunction(id=>document.querySelector('.library-item.selected')?.dataset.id===id,item.id);
   await p.waitForTimeout(350);
   const layout=await p.locator('#libraryList').evaluate(list=>{
    const listWidth=list.getBoundingClientRect().width;
    const rows=[...list.querySelectorAll('.library-entry')].slice(0,10).map(entry=>({entryWidth:entry.getBoundingClientRect().width,itemWidth:entry.querySelector('.library-item')?.getBoundingClientRect().width||0,title:entry.querySelector('.library-title')?.textContent?.trim()||''}));
    return {listWidth,rows};
   });
   assert(layout.listWidth>100,'library list should have usable width during MP3 playback');
   assert(layout.rows.length&&layout.rows.every(row=>row.entryWidth>layout.listWidth*.9&&row.itemWidth>layout.listWidth*.9&&row.title),'library rows should remain full width during MP3 playback');
  }
  const scope=await p.locator('#audioScope').evaluate(el=>({width:el.width,nonempty:el.getContext('2d').getImageData(0,0,el.width,el.height).data.some(x=>x!==0)}));
  assert(scope.width>1&&scope.nonempty);
  await p.locator('#eqPreset').selectOption('builtin:Rock');
  assert.match(await p.locator('#eqPresetStatus').textContent(),/Rock loaded/);
  assert.equal(await p.locator('#eq-value-0-0').textContent(),'+4.0');
  assert.equal(await p.locator('#eq-value-1-0').textContent(),'+4.0');
  await p.locator('#stage').click();assert(await p.locator('#media').evaluate(el=>el.paused));
  await p.locator('#stage').click();await p.waitForFunction(()=>!document.querySelector('#media').paused);
  await p.locator('#stop').click();assert.equal(await p.locator('#media').evaluate(el=>el.currentTime),0);
  await p.locator('#volume').fill('0.36');assert.equal(await p.locator('#media').evaluate(el=>el.volume),.36);
  await p.screenshot({path:path.join(artifacts,'reference-spa-audio.png'),fullPage:true});
  await p.locator('[data-id="'+video.id+'"]').click();await p.waitForFunction(()=>document.querySelector('#media').videoWidth>0&&document.querySelector('#media').currentTime>.2);
  assert.equal(p.url(),'http://127.0.0.1:8080/');assert.equal(await p.locator('#media').count(),1);
  await p.locator('#seek').fill('500');assert(await p.locator('#media').evaluate(el=>Math.abs(el.currentTime-el.duration*.5)<1));
  await p.locator('#stage').click();
  await p.screenshot({path:path.join(artifacts,'reference-spa-video.png'),fullPage:true});
  for(let cycle=0;cycle<3;cycle++){
   await p.locator('#libraryPanel summary').click();assert.equal(await p.locator('#libraryPanel').evaluate(el=>el.open),false);
   await p.locator('#libraryPanel summary').click();assert.equal(await p.locator('#libraryPanel').evaluate(el=>el.open),true);
   const row=await p.locator('.library-item').first().evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,title:el.querySelector('.library-title')?.textContent||''}));
   assert(row.width>100&&row.height>30&&row.title,'library row should retain its layout after close/open');
  }
  await p.locator('[data-filter="albums"]').click();assert.equal(await p.locator('.library-album').count(),3);
  await p.locator('.library-album').first().click();assert.match(await p.locator('.library-item').nth(1).textContent(),/^01 ·/);
  for(const width of [390,320]){await p.setViewportSize({width,height:900});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow at '+width);await p.screenshot({path:path.join(artifacts,'reference-spa-'+width+'.png'),fullPage:true});}
  await p.waitForFunction(()=>document.querySelector('#commandState').textContent.includes('WASM READY'),null,{timeout:60000});
  assert.equal(workers,1);assert.equal(await p.locator('#pushToTalk').isDisabled(),false);assert(await p.locator('#wakewordToggle').isDisabled());
  assert.match(await p.locator('#wakewordStatus').textContent(),/PTT READY/);
  assert(!requests.some(url=>url.includes('/api/command')||url.includes('/api/wakeword')));
  assert(requests.every(url=>url.startsWith('http://127.0.0.1:8080/')||url.startsWith('blob:')));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,files:manifest.items.length,workers,scope}));
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
