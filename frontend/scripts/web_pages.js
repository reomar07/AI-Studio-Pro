/* Web search: optionally choose which result pages are read, with a clear notice of what is sent where. */
(function () {
  'use strict';
  const KEY = 'aspro_web_search_v1', CONFIG_KEY = 'web_search_preferences', MAX_PICK = 5;
  function normalize(raw) { raw = raw && typeof raw === 'object' ? raw : {}; return {mode: raw.mode === 'choose' ? 'choose' : 'results'}; }
  function noticeLines(provider, picked) {
    const lines = ['Web search services receive the words of your question (up to 300 characters) to find results.'];
    if (picked > 0) lines.push('This app then downloads the ' + picked + ' page' + (picked === 1 ? '' : 's') + ' you ticked directly from ' + (picked === 1 ? 'its website' : 'their websites') + '. Those sites can see your internet address.');
    if (!provider) lines.push('The provider for this chat could not be determined. Your message and the web text are sent to it.');
    else if (provider.is_local) lines.push('Your AI provider (' + provider.profile + ') runs on this computer (' + provider.host + '), so your message and the page text are not sent to an online provider.');
    else lines.push('Your AI provider (' + provider.profile + ', ' + provider.host + ') receives your message, the titles and snippets of the top search results' + (picked > 0 ? ', and the text read from the ticked pages (up to 6,000 characters each)' : '') + '.');
    return lines;
  }
  // Decides whether the page-choosing step runs before a message is sent. Returns what the original send returned, or undefined if cancelled.
  async function runGate(deps, original) {
    if (deps.mode !== 'choose' || !deps.webActive || deps.generating || deps.imageMode || !deps.text) return original();
    const picked = await deps.ask(deps.text);
    if (picked === null) return undefined;
    try {
      await deps.api.web_clear_selected_pages();
      if (picked.length) {
        const result = await deps.api.web_select_pages(picked);
        if (!result || !result.ok || !result.accepted.length) throw new Error('none accepted');
      }
    } catch (_) { deps.notify('The chosen pages could not be prepared, so nothing was sent. Try again.'); return undefined; }
    return original();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {normalize, noticeLines, runGate};
  if (typeof document === 'undefined') return;
  let prefs = normalize({}), ready = false, dirty = false, saves = Promise.resolve();
  try { prefs = normalize(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) {}
  const byId = id => document.getElementById(id), toast = text => { if (typeof showToast === 'function') showToast(text); };
  function persist(previous) {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) {}
    if (!ready) return;
    const snapshot = Object.assign({}, prefs);
    if (typeof globalConfig !== 'undefined' && globalConfig) globalConfig[CONFIG_KEY] = snapshot;
    saves = saves.catch(() => {}).then(() => window.pywebview.api.save_config({[CONFIG_KEY]: snapshot})).then(ok => { if (ok !== true) throw new Error('save failed'); })
      .catch(() => { prefs = previous; fill(); if (typeof globalConfig !== 'undefined' && globalConfig) globalConfig[CONFIG_KEY] = Object.assign({}, prefs); toast('Could not save the web search setting.'); });
  }
  function fill() { const c = byId('aspro-web-choose'); if (c) c.checked = prefs.mode === 'choose'; }
  function addSetting() {
    const dialog = byId('aspro-preferences');
    if (!dialog || byId('aspro-web-settings')) return;
    const section = document.createElement('section'); section.id = 'aspro-web-settings'; section.className = 'aspro-feature-section';
    section.innerHTML = '<h3>Web search</h3><label class="aspro-inline"><input type="checkbox" id="aspro-web-choose"> Let me choose which result pages are read</label><p>Applies when the Web button is on. Before sending you see the search results, tick the pages to read, and get a notice of what is sent to which service.</p>';
    const reset = byId('aspro-reset');
    if (reset && reset.parentNode === dialog) dialog.insertBefore(section, reset); else dialog.appendChild(section);
    byId('aspro-web-choose').addEventListener('change', e => { dirty = true; const previous = prefs; prefs = normalize({mode: e.target.checked ? 'choose' : 'results'}); persist(previous); });
    fill();
  }
  async function load() {
    if (ready || !window.pywebview || !window.pywebview.api) return;
    try {
      const cfg = await window.pywebview.api.get_config();
      if (!dirty && cfg && cfg[CONFIG_KEY]) prefs = normalize(cfg[CONFIG_KEY]);
      ready = true; fill();
    } catch (_) {}
  }
  let dialog = null;
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function ask(question) {
    return new Promise(resolve => {
      if (!dialog) { dialog = el('dialog', 'aspro-panel aspro-web-dialog'); dialog.id = 'aspro-web-pages'; document.body.appendChild(dialog); }
      dialog.replaceChildren();
      let provider = null, results = [], settled = false;
      const title = el('h2', '', 'Choose pages to read'), query = el('p', 'aspro-web-query', 'Search: ' + question.slice(0, 120));
      const list = el('div', 'aspro-web-list'), notice = el('div', 'aspro-web-notice'), actions = el('div', 'aspro-web-actions');
      const cancel = el('button', 'aspro-toolbar', 'Cancel'), plain = el('button', 'aspro-toolbar', 'Send with search results only'), read = el('button', 'aspro-toolbar', 'Read ticked pages and send');
      for (const b of [cancel, plain, read]) b.type = 'button';
      read.disabled = true; actions.append(cancel, plain, read); dialog.append(title, query, list, notice, actions);
      const boxes = [];
      const finish = value => { if (settled) return; settled = true; if (dialog.open) dialog.close(); resolve(value); };
      function renderNotice() {
        const n = boxes.filter(b => b.checked).length; read.disabled = n === 0;
        for (const b of boxes) b.disabled = !b.checked && n >= MAX_PICK;
        notice.replaceChildren(el('strong', '', 'What is sent'), ...noticeLines(provider, n).map(line => el('p', '', line)));
      }
      list.textContent = 'Searching…'; renderNotice();
      cancel.onclick = () => finish(null); plain.onclick = () => finish([]);
      read.onclick = () => finish(boxes.filter(b => b.checked).map(b => b.value));
      dialog.addEventListener('close', () => finish(null), {once: true});
      if (!dialog.open) dialog.showModal();
      (async () => {
        try {
          const chat = typeof activeChatId !== 'undefined' ? activeChatId : null;
          provider = await window.pywebview.api.web_provider_notice(chat);
        } catch (_) { provider = null; }
        try {
          const found = await window.pywebview.api.web_search_preview(question);
          results = found && found.ok ? found.results : [];
          list.replaceChildren();
          if (!found || !found.ok) list.textContent = 'The search failed' + (found && found.error ? ' (' + found.error + ')' : '') + '. You can still send without web pages.';
          else if (!results.length) list.textContent = 'No results were found.';
          for (const r of results) {
            const row = el('label', 'aspro-web-row'), box = document.createElement('input');
            box.type = 'checkbox'; box.value = r.url; box.addEventListener('change', renderNotice); boxes.push(box);
            const text = el('span', 'aspro-web-text'); text.append(el('strong', '', r.title), el('small', '', r.url), el('span', '', r.snippet));
            row.append(box, text); list.appendChild(row);
          }
        } catch (_) { list.textContent = 'The search failed. You can still send without web pages.'; }
        renderNotice();
      })();
    });
  }
  function install() {
    addSetting();
    const original = window.handleAction;
    if (typeof original !== 'function') throw new Error('handleAction is not available');
    window.handleAction = function () {
      const self = this, args = arguments, input = byId('prompt-input');
      return runGate({
        mode: prefs.mode, text: ((input && input.value) || '').trim(),
        webActive: typeof isWebSearchActive !== 'undefined' && isWebSearchActive, generating: typeof isGenerating !== 'undefined' && isGenerating,
        imageMode: typeof isImageMode !== 'undefined' && isImageMode, ask, api: window.pywebview && window.pywebview.api, notify: toast
      }, () => original.apply(self, args));
    };
    window.addEventListener('pywebviewready', load); load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once: true}); else install();
  window.AsproWebPages = {version: 1, getPreferences: () => Object.assign({}, prefs)};
  window.__asproWebPagesVersion = 1;
})();
