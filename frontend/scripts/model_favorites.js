/* Model shortcuts v1. Loaded after app.js by bootstrap.js. */
(function () {
  'use strict';
  let favorites = [], recents = [], busy = false, request = 0;
  const api = () => window.pywebview && window.pywebview.api;
  const identity = () => {
    const id = globalConfig && (globalConfig.active_profile_id || 'default');
    const profile = globalConfig && globalConfig.profiles && globalConfig.profiles[id];
    return JSON.stringify([id, profile && profile.base_url]);
  };
  function apply(result) {
    if (!result || !result.ok) throw new Error('Model shortcuts unavailable');
    favorites = Array.isArray(result.favorites) ? result.favorites.slice() : [];
    recents = Array.isArray(result.recents) ? result.recents.slice() : [];
    if (globalConfig) {
      globalConfig.favorite_models = favorites.slice();
      globalConfig.recent_models = recents.slice();
    }
  }
  function repaint() {
    if (globalConfig) filterModels(document.getElementById('model-search').value || '');
  }
  async function loadPreferences() {
    try { apply(await api().get_model_preferences()); }
    catch (error) { showToast('Model shortcuts could not load. Use the complete updated app folder.'); }
  }
  async function selectModel(id) {
    if (!globalConfig || busy) return;
    if (isGenerating) return showToast('Wait for the current reply before changing models.');
    busy = true;
    try {
      const next = JSON.parse(JSON.stringify(globalConfig));
      const active = next.active_profile_id || 'default';
      if (!next.profiles) next.profiles = {};
      if (!next.profiles[active]) next.profiles[active] = {};
      next.profiles[active].model_name = id;
      next.model_name = id;
      // Leave preference fields to their dedicated backend methods.
      delete next.favorite_models; delete next.recent_models;
      const saved = await api().save_config(next);
      if (saved !== true) throw new Error('Model selection could not be saved');
      globalConfig = Object.assign({}, globalConfig, next);
      refreshActiveModelDisplay();
      document.getElementById('model-dropdown').classList.add('hidden');
      try { apply(await api().record_model_selection(id)); }
      catch (error) { showToast('Model selected, but the recent-model shortcut could not be saved.'); }
    } catch (error) { showToast('Could not save the model selection. Your previous model is unchanged.'); }
    finally { busy = false; repaint(); }
  }
  async function star(id) {
    if (busy) return;
    busy = true;
    try { apply(await api().toggle_model_favorite(id)); }
    catch (error) { showToast('Could not save the model favorite.'); }
    finally { busy = false; repaint(); }
  }
  function button(text, label, handler) {
    const node = document.createElement('button'); node.type = 'button';
    node.textContent = text; node.title = label; node.setAttribute('aria-label', label);
    node.onclick = handler; return node;
  }
  window.populateModelList = function (models) {
    const list = document.getElementById('model-list'); list.innerHTML = '';
    if (!globalConfig) return;
    const q = (document.getElementById('model-search').value || '').trim().toLowerCase();
    const profile = (globalConfig.profiles || {})[globalConfig.active_profile_id || 'default'] || {};
    const local = /localhost|127\.0\.0\.1|\[::1\]/i.test(profile.base_url || globalConfig.base_url || '');
    const catalog = new Map((local && !modelsLive ? [] : currentModels).map(m => [m.id, m]));
    const matches = m => String(m.name).toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
    const seen = new Set();
    function section(title, entries) {
      if (!entries.length) return;
      const heading = document.createElement('div'); heading.textContent = title;
      heading.className = 'px-2 py-1 text-[11px] font-bold text-zinc-500 uppercase'; list.appendChild(heading);
      entries.forEach(m => {
        seen.add(m.id);
        const row = document.createElement('div'); row.className = 'flex items-center gap-1 rounded p-1 hover:bg-zinc-100 dark:hover:bg-[#2d2d2f]';
        row.dataset.modelId = m.id;
        const listed = catalog.has(m.id), disabled = modelsLive && !listed;
        const choose = button('', 'Select ' + m.id, () => selectModel(m.id));
        choose.disabled = disabled; choose.className = 'flex-1 min-w-0 p-1 text-left';
        const name = document.createElement('span'); name.className = 'block font-semibold truncate text-black dark:text-zinc-200'; name.textContent = m.name;
        const detail = document.createElement('span'); detail.className = 'block text-[10px] text-zinc-500 font-mono break-all';
        detail.textContent = m.id + (disabled ? ' — Not listed by active provider' : !modelsLive ? ' — Availability unverified' : '');
        choose.appendChild(name); choose.appendChild(detail);
        const starred = favorites.includes(m.id);
        const pin = button(starred ? '★' : '☆', (starred ? 'Remove favorite ' : 'Favorite ') + m.id, () => star(m.id));
        pin.className = 'p-2 text-lg text-amber-600 dark:text-amber-400'; pin.setAttribute('aria-pressed', String(starred));
        row.appendChild(choose); row.appendChild(pin); list.appendChild(row);
      });
    }
    function shortcuts(ids) {
      return ids.filter(id => typeof id === 'string' && !seen.has(id)).map(id => catalog.get(id) || {id, name:id}).filter(matches);
    }
    section('Favorites', shortcuts(favorites));
    section('Recent', shortcuts(recents));
    if (local && !modelsLive) {
      const info = document.createElement('div'); info.className = 'p-2 text-xs text-zinc-500';
      info.textContent = 'Could not read the local model list. Check the server, or type a custom model ID above.';
      list.appendChild(info); return;
    }
    const remaining = models.filter(m => !seen.has(m.id));
    section(modelsLive ? 'All models' : 'Suggested models (unverified)', remaining.slice(0, 300));
    if (remaining.length > 300) {
      const more = document.createElement('div'); more.className = 'p-2 text-xs text-zinc-500';
      more.textContent = 'Showing the first 300 of ' + remaining.length + ' other models. Type above to search.'; list.appendChild(more);
    }
  };
  window.filterModels = function (value) {
    const text = String(value || '').trim(), q = text.toLowerCase();
    const filtered = currentModels.filter(m => String(m.name).toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
    populateModelList(filtered);
    if (text && !currentModels.some(m => m.id === text)) {
      const custom = button('Use custom: ' + text, 'Use custom model ' + text, () => selectModel(text));
      custom.className = 'block w-full p-2 text-left text-blue-600 dark:text-blue-400';
      document.getElementById('model-list').prepend(custom);
    }
  };
  window.refreshModels = async function () {
    if (!globalConfig || !api()) return;
    const serial = ++request, provider = identity();
    await loadPreferences();
    try {
      const result = await api().list_models();
      if (serial !== request || provider !== identity()) return;
      if (result && result.ok && Array.isArray(result.models)) {
        currentModels = result.models; modelsLive = true;
      } else { currentModels = KNOWN_MODELS.slice(); modelsLive = false; }
    } catch (error) {
      if (serial !== request || provider !== identity()) return;
      currentModels = KNOWN_MODELS.slice(); modelsLive = false;
    }
    repaint();
  };
  window.__asproModelFavoritesVersion = 1;
  if (globalConfig && api()) refreshModels();
})();
