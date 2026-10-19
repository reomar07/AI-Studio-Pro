/* Chat model memory v2: keep app.js unchanged; synchronize before sending. */
(function () {
  'use strict';
  function install() {
    const api = window.pywebview && window.pywebview.api;
    if (!api || window.AsproChatModelMemory) return;
    const original = {};
    ['set_current_chat', 'start_new_chat', 'get_config', 'save_config',
      'get_chat_model_binding', 'set_chat_model_binding', 'send_prompt_stream', 'list_models']
      .forEach(name => { if (typeof api[name] === 'function') original[name] = api[name].bind(api); });
    if (!original.set_current_chat || !original.get_chat_model_binding || !original.get_config) return;
    let tail = Promise.resolve(), current = null, binding = null, error = '', switching = 0;
    let backendProfile = null, lastNotice = '', epoch = 0;
    const clone = value => JSON.parse(JSON.stringify(value));
    let statusTimer = null;
    function status(text, notify) {
      if (statusTimer !== null) { clearTimeout(statusTimer); statusTimer = null; }
      let node = document.getElementById('chat-model-memory-status');
      const picker = document.getElementById('active-model-display');
      if (!node && picker && picker.parentElement) {
        node = document.createElement('div'); node.id = 'chat-model-memory-status';
        node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
        node.style.cssText = 'position:absolute;bottom:calc(100% + 8px);right:0;max-width:360px;font:11px Segoe UI,Arial;color:inherit;background:inherit;padding:4px 8px;border:1px solid #64748b;border-radius:6px;cursor:pointer';
        picker.parentElement.appendChild(node);
      }
      if (node) {
        node.textContent = text;
        const dismiss = () => {
          if (statusTimer !== null) { clearTimeout(statusTimer); statusTimer = null; }
          if (document.getElementById('chat-model-memory-status') === node) node.remove();
        };
        node.onclick = dismiss;
        statusTimer = setTimeout(dismiss, 5000);
      }
      if (picker) picker.title = text;
      if (notify && typeof showToast === 'function') showToast(text);
    }
    function fail(text) {
      error = text;
      const picker = document.getElementById('active-model-display');
      if (picker) picker.innerText = 'Model unavailable';
      status(text, true);
      return false;
    }
    function project(cfg) {
      const next = clone(cfg);
      if (!binding || error) return next;
      const p = next.profiles && next.profiles[binding.profile_id];
      if (!p) throw new Error('Missing provider');
      next.active_profile_id = binding.profile_id;
      p.model_name = binding.model_name; p.image_model = binding.image_model;
      ['model_name', 'image_model', 'base_url', 'api_key', 'custom_headers'].forEach(k => { next[k] = p[k] || ''; });
      return next;
    }
    const display = window.refreshActiveModelDisplay;
    window.refreshActiveModelDisplay = function () {
      if (error) { const p = document.getElementById('active-model-display'); if (p) p.innerText = 'Model unavailable'; return; }
      if (globalConfig && binding) globalConfig = project(globalConfig);
      return display.apply(this, arguments);
    };
    function enqueue(task) {
      const result = tail.then(task);
      tail = result.catch(() => {});
      return result;
    }
    async function restore(id, announce) {
      try {
        const cfg = await original.get_config();
        backendProfile = cfg.active_profile_id || 'default';
        const result = await original.get_chat_model_binding(id);
        if (!result || !result.ok || !result.binding) return fail('Cannot restore this chat\'s model. Choose an existing provider/model before sending.');
        const oldProvider = globalConfig && globalConfig.active_profile_id;
        binding = clone(result.binding); error = ''; globalConfig = project(cfg);
        refreshActiveModelDisplay();
        if (oldProvider !== binding.profile_id) { currentModels = KNOWN_MODELS.slice(); modelsLive = false; }
        const p = globalConfig.profiles[binding.profile_id];
        const text = (result.remembered ? 'Restored this chat: ' : 'Using global default: ') + binding.model_name + ' | Provider: ' + (p.name || binding.profile_id);
        const key = JSON.stringify([id, binding]);
        status(text, announce && result.remembered && key !== lastNotice); lastNotice = key;
        return true;
      } catch (_) { return fail('Could not verify this chat\'s model. Sending is blocked; reopen the chat or select its model again.'); }
    }
    api.set_current_chat = function (id) {
      switching++; epoch++; status("Restoring this chat's provider/model...", false);
      return enqueue(async () => {
        try {
          const result = await original.set_current_chat(id);
          const changed = current !== id; current = id; binding = null;
          await restore(id, changed); return result;
        } catch (_) { fail('Chat switch failed. Reopen the chat before sending.'); return false; }
        finally { switching--; }
      });
    };
    if (original.start_new_chat) api.start_new_chat = function () {
      const args = arguments; switching++; epoch++;
      return enqueue(async () => {
        try { current = await original.start_new_chat(...args); binding = null; await restore(current, false); return current; }
        catch (_) { fail('Could not initialize the new chat model.'); throw new Error('Chat initialization failed'); }
        finally { switching--; }
      });
    };
    api.get_config = async function () {
      await tail;
      const cfg = await original.get_config(); backendProfile = cfg.active_profile_id || 'default';
      return project(cfg);
    };
    if (original.save_config && original.set_chat_model_binding) api.save_config = function (cfg) {
      if (switching) { status('Wait for the chat model to finish restoring before changing it.', true); return Promise.resolve(false); }
      const target = current, next = clone(cfg), pid = next.active_profile_id || 'default';
      const p = next.profiles && next.profiles[pid];
      return enqueue(async () => {
        try {
          const saved = await original.save_config(next);
          if (saved !== true) { if (target) fail('Settings were not saved. Select the chat model again before sending.'); return false; }
          backendProfile = pid;
          if (!target) return saved;
          if (binding && !next.profiles[binding.profile_id]) return fail('The saved provider was deleted. Choose a replacement explicitly before sending.');
          if (!p || !p.model_name) return fail('Choose a valid model before sending.');
          const result = await original.set_chat_model_binding(target, pid, p.model_name, p.image_model || '');
          if (!result || !result.ok) return fail('This chat\'s model choice was not saved. Sending is blocked until you select it again.');
          if (!await restore(target, false)) return false;
          status('Saved for this chat: ' + binding.model_name + ' | Provider: ' + (globalConfig.profiles[pid].name || pid), true);
          return true;
        } catch (_) { return fail('Could not save this chat\'s model. Select it again before sending.'); }
      });
    };
    // A catalog from another active provider must not be presented as verified.
    if (original.list_models) api.list_models = async function () {
      await tail;
      if (error || (binding && binding.profile_id !== backendProfile)) return {ok: false, models: [], error: 'Provider catalog unverified for this chat; use a custom model ID.'};
      return original.list_models();
    };
    async function verify() {
      await tail;
      if (error) return fail(error);
      if (!current) return true;
      try {
        const expected = current, ticket = epoch;
        const result = await original.get_chat_model_binding(expected);
        if (ticket !== epoch || expected !== current) return fail('The chat changed while checking its model. Reopen the intended chat before sending.');
        const b = result && result.binding, p = globalConfig && globalConfig.profiles && globalConfig.profiles[globalConfig.active_profile_id];
        if (!result || !result.ok || !b || !p || activeChatId !== current || b.profile_id !== globalConfig.active_profile_id || b.model_name !== p.model_name || b.image_model !== (p.image_model || '') || document.getElementById('active-model-display').innerText.replace(/\s*▾$/, '').trim() !== b.model_name)
          return fail('The picker and saved chat model disagree. Reopen the chat or choose its model again before sending.');
        return true;
      } catch (_) { return fail('Could not verify the selected model. No request was sent.'); }
    }
    ['handleAction', 'regenerateMessage'].forEach(name => {
      const handler = window[name];
      if (typeof handler === 'function') window[name] = async function () {
        if (isGenerating && name === 'handleAction') return handler.apply(this, arguments);
        if (!await verify()) return;
        return handler.apply(this, arguments);
      };
    });
    if (original.send_prompt_stream) api.send_prompt_stream = async function () {
      if (!await verify()) throw new Error('Chat model verification failed');
      return original.send_prompt_stream(...arguments);
    };
    window.AsproChatModelMemory = {version: 2, whenIdle: () => tail};
  }
  window.addEventListener('pywebviewready', install);
  install();
})();
