/* Playback-state tests use simulated speech and settings; no real audio or AI calls. */
const {chromium}=require('playwright');
const http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><aside><div></div></aside><main></main></body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.spoken=[];window.legacyReads=0;window.saved=[];window.showToast=text=>window.lastNotice=text;
   const voices=[{voiceURI:'en-local',name:'English',lang:'en-US',localService:true},{voiceURI:'fr-local',name:'French',lang:'fr-FR',localService:true},{voiceURI:'ar-remote',name:'Arabic',lang:'ar-SA',localService:false}];
   Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
   Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>voices,addEventListener(){},cancel(){},speak(u){window.spoken.push(u);window.lastUtterance=u;if(u.onstart)u.onstart({});},pause(){if(window.lastUtterance.onpause)window.lastUtterance.onpause({});},resume(){if(window.lastUtterance && window.lastUtterance.onresume)window.lastUtterance.onresume({});}}});
   window.pywebview={api:{get_config:async()=>({voice_preferences:JSON.parse(localStorage.getItem('__voice_test')||'null')}),save_config:async cfg=>{window.saved.push(cfg);localStorage.setItem('__voice_test',JSON.stringify(cfg.voice_preferences));return true;}}};
   document.addEventListener('click',e=>{if(e.target.closest('[data-action="listen-text"]'))window.legacyReads++;});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.addStyleTag({path:path.resolve('frontend/styles/themes.css')});
  await page.addScriptTag({path:path.resolve('frontend/scripts/speech.js')});
  await page.waitForFunction(()=>window.__asproVoiceReady);
  await page.getByRole('button',{name:'Voice & playback',exact:true}).click();
  await page.locator('#voice-language').selectOption('fr');
  await page.locator('#voice-rate').evaluate(el=>{el.value='1.2';el.dispatchEvent(new Event('input'));});
  await page.getByRole('button',{name:'Test voice',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.lastUtterance.voice.voiceURI),'fr-local');
  assert.equal(await page.evaluate(()=>window.lastUtterance.rate),1.2);
  await page.keyboard.press('Escape');
  await page.locator('#voice-pause').click();assert.equal(await page.locator('#voice-pause').textContent(),'Resume');
  await page.locator('#voice-pause').click();assert.equal(await page.locator('#voice-pause').textContent(),'Pause');
  await page.locator('#voice-stop').click();assert.equal(await page.locator('#aspro-player').isVisible(),false);
  await page.evaluate(()=>{const b=document.createElement('button');b.id='fake-listen';b.textContent='Listen hook';b.dataset.action='listen-text';b.dataset.payload=encodeURIComponent('Bonjour vous pouvez lire ceci. '+('Une phrase pour tester. '.repeat(100))+'\n```py\nsecret_code\n```');document.body.appendChild(b);});
  await page.locator('#fake-listen').click();assert.equal(await page.evaluate(()=>window.legacyReads),0);
  assert.equal(await page.evaluate(()=>window.lastUtterance.text.includes('secret_code')),false);
  assert.ok(await page.evaluate(()=>window.lastUtterance.text.length<=300));
  const count=await page.evaluate(()=>window.spoken.length);await page.evaluate(()=>window.lastUtterance.onend({}));
  await page.waitForFunction(n=>window.spoken.length===n+1,count);
  await page.locator('#voice-stop').click();const stopped=await page.evaluate(()=>window.spoken.length);
  await page.evaluate(()=>window.lastUtterance.onend({}));await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.spoken.length),stopped);
  await page.getByRole('button',{name:'Voice & playback',exact:true}).click();await page.locator('#voice-language').selectOption('ar');
  await page.getByRole('button',{name:'Test voice',exact:true}).click();assert.equal(await page.evaluate(()=>window.spoken.length),stopped);
  await page.locator('#voice-remote').check();await page.getByRole('button',{name:'Test voice',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.lastUtterance.voice.voiceURI),'ar-remote');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>window.saved.some(x=>x.voice_preferences.language==='ar'));
  await page.reload();await page.addScriptTag({path:path.resolve('frontend/scripts/speech.js')});
  await page.waitForFunction(()=>document.getElementById('voice-language').value==='ar');assert.deepEqual(errors,[]);
  console.log('Voice UI, settings, language matching, pause/resume/stop, chunking and Listen interception passed with simulated speech.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
