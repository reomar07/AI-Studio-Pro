const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'frontend/scripts/app.js'), 'utf8');
const addon = fs.readFileSync(path.join(root, 'frontend/scripts/chat-model-memory.js'), 'utf8');
const clone = x => JSON.parse(JSON.stringify(x));
function harness(delayed = false) {
  const nodes = new Map(), listeners = new Map(), toasts = [], requests = [], writes = [];
  class Element {
    constructor() {
      this.children = []; this.style = {}; this.dataset = {}; this.value = '';
      this.innerText = ''; this.textContent = ''; this.checked = false; this.title = '';
      this.scrollHeight = 0; this.clientHeight = 0; this.scrollTop = 0;
      const classes = new Set(['hidden']);
      this.classList = {add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)),
        contains: x => classes.has(x), toggle(x) {if (classes.has(x)) {classes.delete(x); return false;} classes.add(x); return true;}};
    }
    set id(x) { this._id = x; nodes.set(x, this); }
    get id() {return this._id;}
    set innerHTML(x) {this.html = x; this.children = [];}
    get innerHTML() {return this.html || '';}
    appendChild(x) {x.parentElement = this; this.children.push(x); return x;}
    prepend(x) {x.parentElement = this; this.children.unshift(x);}
    querySelector() {return new Element();}
    querySelectorAll() {return [];}
    setAttribute(k, v) {this[k] = v;}
    addEventListener() {}
    remove() {}
    focus() {}
  }
  const document = {createElement: () => new Element(), documentElement: new Element(),
    getElementById(id) {if (id === 'chat-model-memory-status' && !nodes.has(id)) return null; if (!nodes.has(id)) {const n = new Element(); n.id = id;} return nodes.get(id);},
    querySelector: () => null, addEventListener() {}};
  document.body = new Element(); document.head = new Element();
  const picker = document.getElementById('active-model-display'); new Element().appendChild(picker);
  for (const [id, value] of [['param-temp', '0.7'], ['param-ctx', '10'], ['param-system', ''], ['model-search', '']]) document.getElementById(id).value = value;
  let backendConfig = {active_profile_id: 'cloud', profiles: {
    cloud: {name: 'Cloud provider', model_name: 'claude-opus-5', image_model: '', api_key: 'cloud-test-secret', base_url: 'https://cloud.invalid'},
    local: {name: 'GLM provider', model_name: 'glm-5.3', image_model: '', api_key: 'local-test-secret', base_url: 'http://localhost:1234/v1'}}};
  const bindings = {A: {profile_id: 'local', model_name: 'glm-5.3', image_model: ''}, B: {profile_id: 'cloud', model_name: 'claude-opus-5', image_model: ''}};
  let backendChat = null, serial = 0, bindFailure = false, fetchFailure = false;
  let fetchHook = null, readHold = null;
  const api = {
    async get_config() {return clone(backendConfig);},
    async save_config(cfg) {writes.push(clone(cfg)); backendConfig = clone(cfg); return true;},
    async set_current_chat(id) {backendChat = id;},
    async start_new_chat() {backendChat = 'new_' + (++serial); return backendChat;},
    async get_chat_model_binding(id) {
      if (readHold) await readHold;
      if (fetchFailure) throw Error('simulated fetch failure');
      if (fetchHook) fetchHook(id);
      const b = bindings[id] || {profile_id: backendConfig.active_profile_id, model_name: backendConfig.profiles[backendConfig.active_profile_id].model_name, image_model: ''};
      return backendConfig.profiles[b.profile_id] ? {ok: true, remembered: !!bindings[id], binding: clone(b)} : {ok: false, error: 'missing_profile'};
    },
    async set_chat_model_binding(id, profile_id, model_name, image_model) {
      if (bindFailure) return {ok: false, error: 'save_failed'};
      bindings[id] = {profile_id, model_name, image_model};
      return {ok: true, remembered: true, binding: clone(bindings[id])};
    },
    async send_prompt_stream(text, files, params) {
      const result = await api.get_chat_model_binding(backendChat);
      if (!result.ok) throw Error('missing provider');
      const b = result.binding;
      bindings[backendChat] = clone(b);
      requests.push({chat: backendChat, model: b.model_name, profile: b.profile_id, params: clone(params)});
      return {ok: true};
    },
    async list_models() {return {ok: true, models: [{id: 'claude-opus-5', name: 'Claude'}, {id: 'glm-5.3', name: 'GLM'}]};},
    async get_history() {return {};}, async get_metadata() {return {};}, async get_chat_settings() {return {};},
    async get_version() {return '1.2.1';}, async rewind_chat() {}, async stop_generation() {}
  };
  const context = {document, console, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    localStorage: {getItem: () => null, setItem() {}, removeItem() {}}, alert() {}, navigator: {},
    marked: {Renderer: function () {}, setOptions() {}, parse: text => text}, DOMPurify: {sanitize: x => x}};
  context.window = context;
  context.addEventListener = (name, cb) => {if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(cb);};
  if (!delayed) context.pywebview = {api};
  vm.createContext(context); vm.runInContext(app, context);
  context.showToast = text => toasts.push(text);
  vm.runInContext(addon, context);
  async function idle() {await context.AsproChatModelMemory.whenIdle();}
  async function open(id) {await context.renderChat([], id); await idle();}
  async function send() {document.getElementById('prompt-input').value = 'hello'; await context.handleAction(); context.setGenerationState(false);}
  async function choose(model) {
    context.filterModels(model);
    const custom = document.getElementById('model-list').children[0];
    await custom.onclick(); await idle();
  }
  return {context, api, document, bindings, requests, writes, toasts, open, send, choose, idle,
    picker: () => picker.innerText.replace(/\s*▾$/, '').trim(),
    async ready() {context.pywebview = {api}; const pending = (listeners.get('pywebviewready') || []).map(cb => cb()); await Promise.all(pending);},
    failSave() {bindFailure = true;}, allowSave() {bindFailure = false;},
    failFetch() {fetchFailure = true;},
    deleteProfile(id) {delete backendConfig.profiles[id];},
    hold() {let release; readHold = new Promise(r => {release = r;}); return () => {readHold = null; release();};},
    backendConfig: () => clone(backendConfig)};
}
const cases = [];
function test(name, fn) {cases.push([name, fn]);}
test('GLM -> Claude -> GLM: real app renderChat and handleAction match picker to request', async () => {
  const h = harness();
  await h.open('A'); assert.equal(h.picker(), 'glm-5.3'); await h.send();
  await h.open('B'); assert.equal(h.picker(), 'claude-opus-5'); await h.send();
  await h.open('A'); assert.equal(h.picker(), 'glm-5.3'); await h.send();
  assert.deepEqual(h.requests.map(r => r.model), ['glm-5.3', 'claude-opus-5', 'glm-5.3']);
  assert.deepEqual(h.requests.map(r => r.profile), ['local', 'cloud', 'local']);
  assert.equal(h.backendConfig().active_profile_id, 'cloud');
  assert.ok(h.toasts.some(x => x.includes('Restored this chat: glm-5.3')));
  assert.ok(h.document.getElementById('chat-model-memory-status').textContent.includes('GLM provider'));
  assert.equal(h.document.getElementById('chat-model-memory-status').role, 'status');
});
test('explicit custom picker choice replaces old binding before next send', async () => {
  const h = harness(); await h.open('A');
  await h.choose('claude-opus-5'); assert.equal(h.picker(), 'claude-opus-5');
  await h.send(); assert.equal(h.requests[0].model, 'claude-opus-5');
  assert.equal(h.bindings.A.model_name, 'claude-opus-5');
  assert.equal(h.bindings.B.model_name, 'claude-opus-5');
});
test('pywebviewready installs hooks when bridge was absent at script load', async () => {
  const h = harness(true); assert.equal(h.context.AsproChatModelMemory, undefined);
  await h.ready(); await h.open('A'); await h.send();
  assert.equal(h.picker(), 'glm-5.3'); assert.equal(h.requests[0].model, 'glm-5.3');
});
test('save failure blocks send and preserves draft instead of hidden old-model generation', async () => {
  const h = harness(); await h.open('A'); h.failSave(); await h.choose('claude-opus-5');
  await h.send(); assert.equal(h.requests.length, 0);
  assert.equal(h.document.getElementById('prompt-input').value, 'hello');
  assert.equal(h.picker(), 'Model unavailable');
  h.allowSave(); await h.choose('claude-opus-5'); await h.send(); assert.equal(h.requests[0].model, 'claude-opus-5');
});
test('missing provider and fetch errors show unavailable and block send', async () => {
  const h = harness(); h.deleteProfile('local'); await h.open('A'); await h.send();
  assert.equal(h.requests.length, 0); assert.equal(h.picker(), 'Model unavailable');
  const j = harness(); j.failFetch(); await j.open('A'); await j.send(); assert.equal(j.requests.length, 0);
});
test('settings get_config returns restored context without persisting global defaults', async () => {
  const h = harness(); await h.open('A'); const cfg = await h.api.get_config();
  assert.equal(cfg.active_profile_id, 'local'); assert.equal(cfg.profiles.local.model_name, 'glm-5.3');
  assert.equal(h.writes.length, 0);
});
test('new chat creation clears previous chat target', async () => {
  const h = harness(); await h.open('A'); await h.context.newChat(); await h.idle();
  assert.equal(h.picker(), 'claude-opus-5'); await h.choose('other-model'); await h.send();
  assert.equal(h.bindings.A.model_name, 'glm-5.3'); assert.equal(h.requests[0].chat, 'new_1');
});
test('regeneration uses same verified selection through actual app handler', async () => {
  const h = harness(); await h.open('A'); await h.context.regenerateMessage('reply_1');
  assert.equal(h.requests[0].model, 'glm-5.3'); assert.equal(h.requests[0].params.regenerate, true);
});
test('send waits for delayed restore and rapid switches finish on newest chat', async () => {
  const h = harness(); const release = h.hold();
  await Promise.all([h.context.renderChat([], 'A'), h.context.renderChat([], 'B')]);
  const send = h.send(); assert.equal(h.requests.length, 0); release(); await send; await h.idle();
  assert.equal(h.picker(), 'claude-opus-5'); assert.equal(h.requests[0].chat, 'B');
});
test('tampered display blocks sending rather than using hidden saved model', async () => {
  const h = harness(); await h.open('A'); h.document.getElementById('active-model-display').innerText = 'claude-opus-5';
  await h.send(); assert.equal(h.requests.length, 0);
});
test('repeated redraw avoids duplicate restore toast; foreign provider catalog is unverified', async () => {
  const h = harness(); await h.open('A'); const n = h.toasts.length; await h.open('A');
  assert.equal(h.toasts.length, n); const result = await h.api.list_models(); assert.equal(result.ok, false);
});
test('deleting saved provider never silently rebinds chat to default provider', async () => {
  const h = harness(); await h.open('A'); const cfg = h.backendConfig();
  delete cfg.profiles.local;
  const result = await h.api.save_config(cfg); assert.equal(result, false);
  assert.equal(h.bindings.A.profile_id, 'local'); await h.send(); assert.equal(h.requests.length, 0);
});
(async () => {for (const [name, fn] of cases) {await fn(); console.log('PASS', name);} console.log(cases.length + ' integration regressions passed');})().catch(error => {console.error(error); process.exitCode = 1;});
