const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../frontend/scripts/chat-model-memory.js'), 'utf8');
function harness() {
  const nodes = new Map(), timers = new Map(), children = [], notices = [];
  let now = 0, serial = 0, sent = 0;
  function element() {
    return {style: {}, textContent: '', innerText: '',
      set id(id) {this.key = id; nodes.set(id, this);},
      setAttribute(k, v) {this[k] = v;},
      remove() {nodes.delete(this.key); const i = children.indexOf(this); if (i >= 0) children.splice(i, 1);}};
  }
  const picker = element(); picker.id = 'active-model-display';
  picker.parentElement = {appendChild(node) {children.push(node);}};
  const cfg = {active_profile_id: 'p', profiles: {p: {name: 'Provider', model_name: 'default-model', image_model: ''}}};
  const api = {
    async get_config() {return JSON.parse(JSON.stringify(cfg));},
    async set_current_chat() {},
    async get_chat_model_binding(id) {
      if (id === 'missing') return {ok: false, error: 'missing_profile'};
      return {ok: true, remembered: id !== 'default', binding: {profile_id: 'p', model_name: id === 'default' ? 'default-model' : id, image_model: ''}};
    },
    async send_prompt_stream() {sent++; return {ok: true};}
  };
  const ctx = {console, globalConfig: null, activeChatId: null, currentModels: [], KNOWN_MODELS: [], modelsLive: false, isGenerating: false,
    document: {getElementById: id => nodes.get(id) || null, createElement: element},
    pywebview: {api}, addEventListener() {}, showToast: text => notices.push(text),
    setTimeout(fn, ms) {const id = ++serial; timers.set(id, {at: now + ms, fn}); return id;},
    clearTimeout(id) {timers.delete(id);},
    refreshActiveModelDisplay() {picker.innerText = ctx.globalConfig.profiles[ctx.globalConfig.active_profile_id].model_name;}};
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  function advance(ms) {
    now += ms;
    for (;;) {
      const next = [...timers].find(([, timer]) => timer.at <= now);
      if (!next) break;
      timers.delete(next[0]); next[1].fn();
    }
  }
  return {api, picker, notices, children, timers, advance,
    popup: () => nodes.get('chat-model-memory-status'),
    sent: () => sent,
    async open(id) {ctx.activeChatId = id; await api.set_current_chat(id);}};
}
(async () => {
  let h = harness(); await h.open('model-a');
  assert.ok(h.popup()); assert.equal(h.timers.size, 1);
  h.advance(4999); assert.ok(h.popup()); h.advance(1); assert.equal(h.popup(), undefined);
  assert.equal(h.picker.innerText, 'model-a'); assert.ok(h.picker.title.includes('model-a'));
  console.log('PASS status disappears at five seconds; picker and tooltip remain');

  h = harness(); await h.open('default'); h.advance(5000);
  assert.equal(h.popup(), undefined); assert.equal(h.picker.innerText, 'default-model');
  console.log('PASS global-default status also dismisses');

  h = harness(); await h.open('model-a'); h.advance(4000); await h.open('model-b');
  assert.equal(h.children.length, 1); assert.equal(h.timers.size, 1);
  h.advance(1000); assert.ok(h.popup().textContent.includes('model-b'));
  h.advance(4000); assert.equal(h.popup(), undefined); assert.equal(h.children.length, 0);
  console.log('PASS replacement resets timer; old timer cannot dismiss newer notice; no stacking');

  h = harness(); await h.open('model-a'); h.popup().onclick();
  assert.equal(h.popup(), undefined); assert.equal(h.timers.size, 0);
  await h.open('model-b'); assert.ok(h.popup()); h.advance(5000); assert.equal(h.popup(), undefined);
  console.log('PASS click dismisses immediately and later notifications still work');

  h = harness(); await h.open('missing'); h.advance(5000);
  assert.equal(h.popup(), undefined); assert.equal(h.picker.innerText, 'Model unavailable');
  await assert.rejects(h.api.send_prompt_stream('hello', [], {}), /verification failed/);
  assert.equal(h.sent(), 0);
  console.log('PASS dismissed warning does not remove missing-provider send protection');
})().catch(error => {console.error(error); process.exitCode = 1;});
