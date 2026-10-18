/* Actual page startup in Chromium; app API, vendor libraries and clipboard are simulated. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve('.');
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch(e){res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1400,height:1000}});const errors=[];
 try{
  page.on('pageerror',e=>errors.push(e.message));
  const vendor={
   'tailwind.js':'window.tailwind={};',
   'marked.min.js':'window.marked={Renderer:class{},setOptions(){},parse:s=>String(s)};',
   'purify.min.js':'window.DOMPurify={sanitize:s=>s};',
   'highlight.min.js':'window.hljs={highlightElement(){}};',
   'github-dark.min.css':''
  };
  await page.route('**/vendor/**',route=>{
   const name=new URL(route.request().url()).pathname.split('/').pop();
   return route.fulfill({status:200,contentType:name.endsWith('.css')?'text/css':'text/javascript',body:vendor[name]||''});
  });
  await page.addInitScript(()=>{
   window.savedPreferences=[];window.clipText='';
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.clipText=text;},readText:async()=>window.clipText}});
   window.pywebview={api:{
    get_config:async()=>({active_profile_id:'default',profiles:{default:{name:'Test',model_name:'test',base_url:'https://example.invalid/v1',api_key:''}},ui_preferences:JSON.parse(localStorage.getItem('__test_saved_ui')||'{"theme":"ocean","accent":"#3b82f6","font_size":14,"chat_width":900}')}),
    save_config:async cfg=>{if(cfg.ui_preferences){window.savedPreferences.push(cfg.ui_preferences);localStorage.setItem('__test_saved_ui',JSON.stringify(cfg.ui_preferences));}return true;},
    get_history:async()=>({}),get_metadata:async()=>({}),list_models:async()=>({ok:true,models:[{id:'test',name:'Test'}]}),get_version:async()=>'1.2.1'
   }};
   window.addEventListener('load',()=>window.dispatchEvent(new Event('pywebviewready')));
  });
  const address='http://127.0.0.1:'+server.address().port+'/index.html';
  await page.goto(address);
  await page.addStyleTag({content:'.hidden{display:none!important}'});
  await page.waitForFunction(()=>window.__asproFeaturesReady || window.__asproFeaturesError);
  assert.equal(await page.evaluate(()=>window.__asproFeaturesError),undefined);
  assert.equal(await page.locator('#aspro-feature-status').textContent(),'Themes preview 2: ready');
  await page.waitForFunction(()=>document.documentElement.dataset.asproTheme==='ocean');
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.locator('#aspro-theme').selectOption('paper');
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark')),false);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(250, 245, 233)');
  await page.locator('#aspro-font').evaluate(el=>{el.value='18';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForFunction(()=>window.savedPreferences.some(p=>p.font_size===18 && p.theme==='paper'));
  await page.keyboard.press('Escape');
  const input=page.locator('#prompt-input');await input.fill('hello world');
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  async function menu(start,end){
   await input.scrollIntoViewIfNeeded();
   await input.evaluate((el,range)=>{el.focus({preventScroll:true});el.setSelectionRange(range[0],range[1]);},[start,end]);
   await settle();
   const rect=await input.boundingBox();assert.ok(rect,'Composer must be visible before opening its menu');
   await input.dispatchEvent('contextmenu',{clientX:rect.x+Math.min(10,rect.width/2),clientY:rect.y+Math.min(10,rect.height/2)});
   await settle();
   assert.equal(await page.locator('#aspro-context').isVisible(),true,'Context menu must stay open after focus/layout settles');
  }
  await menu(0,5);
  await page.evaluate(()=>document.dispatchEvent(new Event('scroll')));
  assert.equal(await page.locator('#aspro-context').isVisible(),false,'Later scrolling must still dismiss the menu');
  await menu(0,5);await page.locator('#aspro-context').getByRole('menuitem',{name:'Copy',exact:true}).click();
  await page.waitForFunction(()=>window.clipText==='hello');assert.equal(await input.inputValue(),'hello world');
  await menu(0,5);await page.locator('#aspro-context').getByRole('menuitem',{name:'Cut',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('prompt-input').value===' world');
  await menu(0,0);await page.locator('#aspro-context').getByRole('menuitem',{name:'Undo',exact:true}).click();
  assert.equal(await input.inputValue(),'hello world');
  await page.evaluate(()=>window.clipText='new ');await menu(0,0);await page.locator('#aspro-context').getByRole('menuitem',{name:'Paste',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('prompt-input').value==='new hello world');
  await page.reload();await page.waitForFunction(()=>window.__asproFeaturesReady);
  await page.waitForFunction(()=>document.documentElement.dataset.asproTheme==='paper');
  assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--ui-font')),'18px');
  assert.deepEqual(errors,[]);
  console.log('Page startup, themes, persistent preferences, menu stability, scroll dismissal and clipboard actions passed with simulated services.');
 }finally{
  fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/themes-page.png',fullPage:true}).catch(()=>{});
  fs.writeFileSync('test-results/browser-errors.json',JSON.stringify(errors,null,2));
  await browser.close();await new Promise(r=>server.close(r));
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
