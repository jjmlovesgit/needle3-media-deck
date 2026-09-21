const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');

(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto('http://127.0.0.1:8080');
  await page.waitForFunction(()=>document.querySelector('#commandState').textContent.includes('WASM READY'),null,{timeout:60000});
  await page.locator('#commandSensitivity').fill('0');
  await page.locator('.library-item').first().waitFor({state:'attached'});
  const libraryTitles=await page.locator('.library-item .library-title').allTextContents();
  const sampleTitle=libraryTitles
   .filter(title=>libraryTitles.filter(candidate=>candidate===title).length===1)
   .sort((left,right)=>left.length-right.length)[0];
  assert(sampleTitle,'The test library must contain at least one unique title.');
  const cases=[
   {tool:'play_media',text:'Play '+sampleTitle,verify:()=>page.locator('.track-name').textContent().then(value=>value===sampleTitle)},
   {tool:'control_playback',text:'Pause playback',verify:()=>page.locator('#media').evaluate(element=>element.paused)},
   {tool:'skip_forward_10_seconds',text:'Skip forward 10 seconds',before:()=>page.locator('#media').evaluate(element=>{element.currentTime=20;return element.currentTime}),verify:before=>page.locator('#media').evaluate((element,start)=>element.currentTime>=start+9,before)},
   {tool:'rewind_10_seconds',text:'Rewind 10 seconds',before:()=>page.locator('#media').evaluate(element=>{element.currentTime=20;return element.currentTime}),verify:before=>page.locator('#media').evaluate((element,start)=>element.currentTime<=start-9,before)},
   {tool:'show_mp3_files',text:'Show MP3 files',verify:()=>page.locator('[data-filter="mp3"]').getAttribute('aria-pressed').then(value=>value==='true')},
   {tool:'show_original_videos',text:'Show original videos',verify:()=>page.locator('[data-filter="original_mp4"]').getAttribute('aria-pressed').then(value=>value==='true')},
   {tool:'show_karaoke_files_or_videos',text:'Show karaoke files',verify:()=>page.locator('[data-filter="karaoke_mp4"]').getAttribute('aria-pressed').then(value=>value==='true')},
   {tool:'show_all_media_files',text:'Show all media',verify:()=>page.locator('[data-filter="all"]').getAttribute('aria-pressed').then(value=>value==='true')},
   {tool:'search_library',text:'Find Example Track Alpha',verify:()=>page.locator('#librarySearch').inputValue().then(value=>value==='Example Track Alpha')},
   {tool:'refresh_library',text:'Refresh the library',verify:()=>page.locator('#libraryRefresh').isEnabled()},
   {tool:'set_volume',text:'Set volume to 50 percent',verify:()=>page.locator('#media').evaluate(element=>element.volume===.5)},
   {tool:'load_eq_preset',text:'Load the Rock EQ preset',verify:()=>page.locator('#eqPresetStatus').textContent().then(value=>/Rock loaded/.test(value))},
   {tool:'show_graphic_equalizer_panel',text:'Show graphic equalizer',verify:()=>page.locator('#equalizerPanel').evaluate(element=>element.open&&!element.hidden)},
   {tool:'show_library_panel',text:'Show the library',verify:()=>page.locator('#libraryPanel').evaluate(element=>element.open&&!element.hidden)},
   {tool:'hide_media_library_panel',text:'Hide the library',verify:()=>page.locator('#libraryPanel').evaluate(element=>!element.hidden&&!element.open)},
   {tool:'close_performance_monitor_panel',text:'Close the performance monitor',verify:()=>page.locator('#monitorPanel').evaluate(element=>!element.open)},
   {tool:'close_graphic_equalizer_panel',text:'Close the Graphic Equalizer',before:()=>page.locator('#equalizerPanel').evaluate(element=>{element.open=true;element.hidden=false;return element.open}),verify:()=>page.locator('#equalizerPanel').evaluate(element=>!element.open)}
  ];
  const results=[];
  for(const testCase of cases){
   const before=testCase.before?await testCase.before():undefined;
   await page.locator('#commandInput').fill(testCase.text);await page.locator('#commandRun').click();
   await page.waitForFunction(()=>!document.querySelector('#commandRun').disabled,null,{timeout:60000});
   const status=await page.locator('#commandState').textContent();
   const message=await page.locator('#commandResult').textContent();
   const calls=await page.locator('#validatedCalls').textContent();
   const selected=new RegExp('"name"\\s*:\\s*"'+testCase.tool+'"').test(calls);
   let effect=true,effectError='';
   if(testCase.verify){try{effect=Boolean(await testCase.verify(before));}catch(error){effect=false;effectError=error.message;}}
   results.push({tool:testCase.tool,text:testCase.text,pass:status.includes('LOCAL RESULT')&&selected&&effect,status,message,selected,effect,effectError,calls});
  }
  assert.deepEqual(pageErrors,[]);
  console.log(JSON.stringify({passed:results.filter(result=>result.pass).length,total:results.length,results},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
