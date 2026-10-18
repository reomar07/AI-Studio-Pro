/* Real menu DOM with simulated dictionary API. No provider calls. */
const {chromium}=require('playwright');
const http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><textarea id="first"></textarea><input id="private" type="password"></body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.requests=[];window.showToast=t=>window.notice=t;
   window.pywebview={api:{get_config:async()=>({spelling_preferences:{language:'en'}}),save_config:async()=>true,get_spelling_suggestions:async(word,language)=>{
    window.requests.push({word,language});
    if(word==='slowww')return new Promise(resolve=>window.resolveSpell=resolve);
    return {ok:true,message:'Choose a replacement:',suggestions:word==='Bonjor'?['Bonjour']:['hello']};
   }}};
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.addStyleTag({path:path.resolve('frontend/styles/themes.css')});
  await page.addScriptTag({path:path.resolve('frontend/scripts/context_menu.js')});
  await page.addScriptTag({path:path.resolve('frontend/scripts/spelling.js')});
  const field=page.locator('#first');
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  async function menu(value,start,end){await field.fill(value);await field.evaluate((el,r)=>{el.focus({preventScroll:true});el.setSelectionRange(r[0],r[1]);},[start,end]);await settle();await field.dispatchEvent('contextmenu',{clientX:20,clientY:20});await settle();}
  await menu('say helllo now',4,10);await page.locator('#aspro-context').getByRole('menuitem',{name:'hello',exact:true}).click();
  assert.equal(await field.inputValue(),'say hello now');assert.deepEqual(await page.evaluate(()=>window.requests[0]),{word:'helllo',language:'en'});
  await menu('Bonjor',0,6);await page.getByLabel('Spelling language').selectOption('fr');
  await page.locator('#aspro-context').getByRole('menuitem',{name:'Bonjour',exact:true}).click();assert.equal(await field.inputValue(),'Bonjour');
  assert.ok(await page.evaluate(()=>window.requests.some(x=>x.word==='Bonjor' && x.language==='fr')));
  await menu('helllo',0,6);await page.locator('#aspro-context').getByRole('menuitem',{name:'hello',exact:true}).waitFor();
  await field.evaluate(el=>el.value='changed elsewhere');await page.locator('#aspro-context').getByRole('menuitem',{name:'hello',exact:true}).click();
  assert.equal(await field.inputValue(),'changed elsewhere');
  await menu('slowww',0,6);await page.waitForFunction(()=>typeof window.resolveSpell==='function');
  await menu('helllo',0,6);await page.locator('#aspro-context').getByRole('menuitem',{name:'hello',exact:true}).waitFor();
  await page.evaluate(()=>window.resolveSpell({ok:true,message:'old',suggestions:['stale-result']}));await settle();
  assert.equal(await page.locator('#aspro-context').getByRole('menuitem',{name:'stale-result',exact:true}).count(),0);
  await page.keyboard.press('Escape');const count=await page.evaluate(()=>window.requests.length);
  await page.locator('#private').fill('private');await page.locator('#private').dispatchEvent('contextmenu',{clientX:20,clientY:20});await settle();
  assert.equal(await page.evaluate(()=>window.requests.length),count);assert.equal(await page.locator('#aspro-context').isVisible(),false);
  assert.deepEqual(errors,[]);console.log('Spelling menu replacement, language selection, stale-result and password safety checks passed.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
