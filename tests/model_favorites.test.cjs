const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.value = ''; this.style = {}; this._text = ''; this.disabled = false;
    const classes = new Set(); this.classList = {add:x=>classes.add(x), remove:x=>classes.delete(x), contains:x=>classes.has(x), toggle:x=>classes.has(x)?classes.delete(x):classes.add(x)};
  }
  set innerHTML(value) { assert.equal(value, ''); this.children = []; this._text = ''; }
  get textContent() { return this._text + this.children.map(n=>n.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  setAttribute(k,v) { this.attrs[k] = v; }
  appendChild(n) { this.children.push(n); return n; }
  prepend(n) { this.children.unshift(n); }
  addEventListener() {}
  focus() {}
}
function environment() {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element('div')); return nodes.get(id); };
  let stored = {active_profile_id:'default', profiles:{default:{base_url:'https://provider.invalid/v1', model_name:'old'}}, favorite_models:[], recent_models:[]};
  const clone = x => JSON.parse(JSON.stringify(x));
  const api = {
    get_model_preferences:async()=>({ok:true, favorites:stored.favorite_models, recents:stored.recent_models}),
    toggle_model_favorite:async id=>{stored.favorite_models = stored.favorite_models.includes(id)?stored.favorite_models.filter(x=>x!==id):[id,...stored.favorite_models].slice(0,20);return api.get_model_preferences();},
    record_model_selection:async id=>{stored.recent_models=[id,...stored.recent_models.filter(x=>x!==id)].slice(0,5);return api.get_model_preferences();},
    save_config:async cfg=>{Object.assign(stored,clone(cfg));return true;},
    list_models:async()=>({ok:true,models:[{id:'a',name:'Alpha'},{id:'b',name:'Beta'}]})
  };
  const context = vm.createContext({console, document:{getElementById:node,createElement:t=>new Element(t),documentElement:new Element('html'),addEventListener(){}},
    localStorage:{getItem:()=>null,setItem(){}},marked:{Renderer:function(){},setOptions(){}},setTimeout:()=>0,clearTimeout(){}});
  context.window=context;context.addEventListener=()=>{};context.pywebview={api};
  vm.runInContext(fs.readFileSync(path.join(root,'frontend/scripts/app.js'),'utf8'),context);
  vm.runInContext('globalConfig='+JSON.stringify(stored)+';showToast=message=>{window.lastToast=message;};',context);
  // Start with no bridge: load the actual module, then explicitly refresh in each test.
  context.pywebview=null;
  const install = ()=>vm.runInContext(fs.readFileSync(path.join(root,'frontend/scripts/model_favorites.js'),'utf8'),context);
  install();context.pywebview={api};
  return {context,api,node,stored,install,rows:()=>node('model-list').children.filter(x=>x.dataset.modelId)};
}
let passed=0;
async function test(name, body) { await body(); passed++; console.log('PASS '+name); }
(async()=>{
  await test('actual app bindings replaced; stars do not select a model',async()=>{
    const e=environment();await e.context.refreshModels();
    const row=e.rows()[0];assert.equal(row.dataset.modelId,'a');await row.children[1].onclick();
    assert.deepEqual(e.stored.favorite_models,['a']);assert.equal(e.stored.profiles.default.model_name,'old');
    assert.equal(e.rows()[0].children[1].attrs['aria-pressed'],'true');
  });
  await test('favorites/recent groups deduplicate; selection keeps favorites',async()=>{
    const e=environment();e.stored.favorite_models=['b'];e.stored.recent_models=['a','b'];await e.context.refreshModels();
    assert.deepEqual(e.rows().map(r=>r.dataset.modelId),['b','a']);
    await e.rows()[1].children[0].onclick();assert.equal(e.stored.model_name,'a');assert.deepEqual(e.stored.favorite_models,['b']);
    assert.deepEqual(e.stored.recent_models,['a','b']);assert(e.node('model-dropdown').classList.contains('hidden'));
  });
  await test('missing saved models remain visible and disabled after successful list',async()=>{
    const e=environment();e.stored.favorite_models=['gone'];await e.context.refreshModels();
    assert.equal(e.rows()[0].children[0].disabled,true);assert.match(e.rows()[0].textContent,/Not listed by active provider/);
    await e.rows()[0].children[1].onclick();assert.deepEqual(e.stored.favorite_models,[]);
  });
  await test('custom IDs and malicious labels render as text and record recents',async()=>{
    const e=environment();await e.context.refreshModels();const id='<img src=x onerror=alert(1)>';
    e.node('model-search').value=id;e.context.filterModels(id);
    const custom=e.node('model-list').children[0];assert.equal(custom.textContent,'Use custom: '+id);
    await custom.onclick();assert.equal(e.stored.model_name,id);assert.deepEqual(e.stored.recent_models,[id]);
    e.node('model-search').value='';await e.context.refreshModels();assert.equal(e.rows()[0].children[0].children[0].textContent,id);
  });
  await test('reinitialization reads persisted favorites and recents',async()=>{
    const e=environment();await e.context.refreshModels();await e.rows()[0].children[1].onclick();await e.rows()[1].children[0].onclick();
    e.context.pywebview=null;e.install();e.context.pywebview={api:e.api};await e.context.refreshModels();
    assert.deepEqual(e.rows().map(r=>r.dataset.modelId),['a','b']);assert.equal(e.rows()[0].children[1].attrs['aria-pressed'],'true');
  });
  await test('local offline mode hides cloud fallback and preserves shortcuts',async()=>{
    const e=environment();e.stored.favorite_models=['local-model'];
    vm.runInContext("globalConfig.profiles.default.base_url='http://localhost:1234/v1'",e.context);
    e.api.list_models=async()=>({ok:false});await e.context.refreshModels();
    assert.deepEqual(e.rows().map(r=>r.dataset.modelId),['local-model']);assert.match(e.rows()[0].textContent,/Availability unverified/);
    assert.match(e.node('model-list').textContent,/Check the server/);
  });
  await test('empty provider list is authoritative; failed save does not update model',async()=>{
    const e=environment();e.stored.favorite_models=['a'];e.api.list_models=async()=>({ok:true,models:[]});await e.context.refreshModels();
    assert.equal(e.rows()[0].children[0].disabled,true);
    e.node('model-search').value='custom';e.context.filterModels('custom');e.api.save_config=async()=>{throw new Error('offline');};
    await e.node('model-list').children[0].onclick();assert.equal(e.stored.profiles.default.model_name,'old');
    assert.equal(vm.runInContext('globalConfig.profiles.default.model_name',e.context),'old');assert.match(e.context.lastToast,/Could not save/);
  });
  await test('late model response cannot replace the active provider catalog',async()=>{
    const e=environment();let resolve; e.api.list_models=()=>new Promise(r=>{resolve=r;});const first=e.context.refreshModels();
    await new Promise(r=>setImmediate(r));vm.runInContext("globalConfig.active_profile_id='local';globalConfig.profiles.local={base_url:'http://localhost:1234/v1'}",e.context);
    e.api.list_models=async()=>({ok:true,models:[{id:'local',name:'Local'}]});await e.context.refreshModels();
    resolve({ok:true,models:[{id:'stale',name:'Stale'}]});await first;assert.deepEqual(e.rows().map(r=>r.dataset.modelId),['local']);
  });
  console.log(passed+' tests passed against actual app.js and model_favorites.js');
})().catch(error=>{console.error(error);process.exitCode=1;});
