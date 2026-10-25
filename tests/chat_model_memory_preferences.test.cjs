const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../frontend/scripts/chat-model-memory.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

function harness(options = {}) {
  const nodes = new Map(), toasts = [], calls = {saves: [], bindings: [], sends: 0};
  function element() {
    return {style: {}, textContent: '', innerText: '',
      set id(id) {this.key = id; nodes.set(id, this);},
      setAttribute(k, v) {this[k] = v;}, remove() {nodes.delete(this.key);}};
  }
  const picker = element(); picker.id = 'active-model-display';
  picker.parentElement = {appendChild() {}};
  const config = {active_profile_id: 'cloud', profiles: {
    cloud: {name: 'Cloud', model_name: 'default-model', image_model: ''},
    local: {name: 'GLM', model_name: 'glm-5.3', image_model: ''}}};
  const bindings = {A: {profile_id: 'local', model_name: 'glm-5.3', image_model: ''}};
  const api = {
    async get_config() {return clone(config);},
    async set_current_chat() {},
    async get_chat_model_binding(id) {
      if (options.missingProvider) return {ok: false, error: 'missing_profile'};
      return {ok: true, remembered: true, binding: clone(bindings[id])};
    },
    async set_chat_model_binding(id, profile, model, image) {
      calls.bindings.push([id, profile, model, image]);
      bindings[id] = {profile_id: profile, model_name: model, image_model: image};
      return {ok: true};
    },
    async save_config(cfg) {calls.saves.push(cfg); return options.saveResult === undefined ? true : options.saveResult;},
    async send_prompt_stream() {calls.sends++; return {ok: true};}
  };
  const ctx = {console, globalConfig: null, activeChatId: null, currentModels: [], KNOWN_MODELS: [], modelsLive: false, isGenerating: false,
    document: {getElementById: id => nodes.get(id) || null, createElement: element},
    pywebview: {api}, addEventListener() {}, showToast: text => toasts.push(text),
    setTimeout: () => 1, clearTimeout() {},
    refreshActiveModelDisplay() {picker.innerText = ctx.globalConfig.profiles[ctx.globalConfig.active_profile_id].model_name;}};
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  return {api, calls, toasts, picker,
    async open(id) {ctx.activeChatId = id; await api.set_current_chat(id); await ctx.AsproChatModelMemory.whenIdle();}};
}

(async () => {
  for (const key of ['ui_preferences', 'voice_preferences', 'spelling_preferences']) {
    const h = harness(); await h.open('A');
    const toastsBefore = h.toasts.length;
    assert.equal(await h.api.save_config({[key]: {example: 1}}), true);
    assert.deepEqual(h.calls.saves, [{[key]: {example: 1}}]);
    assert.equal(h.calls.bindings.length, 0);
    assert.equal(h.toasts.length, toastsBefore);
    await h.api.send_prompt_stream('hello', [], {});
    assert.equal(h.calls.sends, 1); assert.equal(h.picker.innerText, 'glm-5.3');
    console.log('PASS ' + key + ' save leaves the open chat sendable');
  }

  let h = harness(); h.api.set_current_chat('A');
  assert.equal(await h.api.save_config({ui_preferences: {theme: 'ocean'}}), true);
  assert.ok(!h.toasts.some(text => text.includes('Wait for the chat model')));
  await h.open('A');
  console.log('PASS preference save is not blocked while a chat model is still restoring');

  h = harness({saveResult: false}); await h.open('A');
  assert.equal(await h.api.save_config({voice_preferences: {}}), false);
  await h.api.send_prompt_stream('hello', [], {});
  assert.equal(h.calls.sends, 1); assert.equal(h.picker.innerText, 'glm-5.3');
  console.log('PASS failed preference save is reported without breaking the chat model');

  h = harness({missingProvider: true}); await h.open('A');
  assert.equal(await h.api.save_config({ui_preferences: {}}), true);
  await assert.rejects(h.api.send_prompt_stream('hello', [], {}), /verification failed/);
  assert.equal(h.calls.sends, 0); assert.equal(h.picker.innerText, 'Model unavailable');
  console.log('PASS preference save never clears a real missing-provider block');

  h = harness(); await h.open('A');
  const full = {active_profile_id: 'cloud', profiles: {
    cloud: {name: 'Cloud', model_name: 'picked', image_model: ''}, local: {name: 'GLM', model_name: 'glm-5.3', image_model: ''}}};
  assert.equal(await h.api.save_config(full), true);
  assert.deepEqual(h.calls.bindings, [['A', 'cloud', 'picked', '']]);
  assert.equal(h.picker.innerText, 'picked');
  console.log('PASS provider/model saves still update the open chat binding');

  h = harness(); await h.open('A');
  for (const odd of [null, undefined, 'text', 7, []]) await h.api.save_config(odd);
  assert.equal(h.calls.saves.length, 5); assert.equal(h.calls.bindings.length, 0);
  console.log('PASS unusual save values reach the backend unchanged and do not throw in the wrapper');
})().catch(error => {console.error(error); process.exitCode = 1;});
