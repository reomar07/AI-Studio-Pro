/* Message display: spacing choice and optional saved message times. Does not change chat or generation code. */
(function () {
  'use strict';
  if (window.__asproMessageDisplayVersion) return;
  const KEY = 'aspro_message_display_v1', CONFIG_KEY = 'message_display_preferences';
  const SPACINGS = ['default', 'comfortable', 'compact'];
  function normalize(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {spacing: SPACINGS.includes(raw.spacing) ? raw.spacing : 'default', show_timestamps: raw.show_timestamps === true};
  }
  function readLocal() { try { return normalize(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) { return normalize({}); } }
  let prefs = readLocal(), ready = false, dirty = false, saves = Promise.resolve(), loading = false, ticket = 0;
  const root = document.documentElement;
  const byId = id => document.getElementById(id);
  function notice(text) { if (typeof showToast === 'function') showToast(text); }
  function applyRoot() {
    root.dataset.asproSpacing = prefs.spacing;
    root.dataset.asproTimestamps = prefs.show_timestamps ? 'true' : 'false';
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) {}
  }
  function fillControls() {
    const s = byId('aspro-message-spacing'), t = byId('aspro-show-timestamps');
    if (s) s.value = prefs.spacing;
    if (t) t.checked = prefs.show_timestamps;
  }
  function formatTime(value) {
    if (typeof value !== 'string' || !value) return '';
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return '';
    try { return new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(ms)); }
    catch (_) { return new Date(ms).toLocaleString(); }
  }
  function decorate(wrapper, message) {
    if (!wrapper || !wrapper.classList) return;
    wrapper.classList.add('aspro-message');
    const inner = wrapper.firstElementChild;
    if (!inner || !message || !message.created_at) return;
    const label = formatTime(message.created_at);
    if (!label) return;
    const time = document.createElement('time');
    time.className = 'aspro-message-time'; time.dateTime = message.created_at;
    time.setAttribute('aria-label', 'Sent ' + label); time.textContent = label;
    inner.appendChild(time);
  }
  function persist(previous) {
    if (!ready) return;
    const snapshot = Object.assign({}, prefs), mine = ++ticket;
    if (typeof globalConfig !== 'undefined' && globalConfig) globalConfig[CONFIG_KEY] = snapshot;
    saves = saves.catch(() => {}).then(() => window.pywebview.api.save_config({[CONFIG_KEY]: snapshot})).then(ok => { if (ok !== true) throw new Error('save failed'); })
      .catch(() => {
        if (mine !== ticket) return;
        prefs = previous; dirty = false; applyRoot(); fillControls();
        if (typeof globalConfig !== 'undefined' && globalConfig) globalConfig[CONFIG_KEY] = Object.assign({}, prefs);
        notice('Could not save message display settings. The previous setting was restored.');
      });
  }
  function change(patch) {
    const previous = prefs;
    prefs = normalize(Object.assign({}, prefs, patch)); dirty = true;
    applyRoot(); fillControls(); persist(previous);
  }
  function addControls() {
    const dialog = byId('aspro-preferences');
    if (!dialog || byId('aspro-message-display-controls')) return;
    const section = document.createElement('section'); section.id = 'aspro-message-display-controls';
    section.innerHTML = '<h3>Messages</h3><label>Message spacing<select id="aspro-message-spacing"><option value="default">Default</option><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><label class="aspro-inline"><input type="checkbox" id="aspro-show-timestamps"> Show time sent on new messages</label><p>Older messages were saved without a time, so they stay undated.</p>';
    const reset = byId('aspro-reset');
    if (reset && reset.parentNode === dialog) dialog.insertBefore(section, reset); else dialog.appendChild(section);
    byId('aspro-message-spacing').addEventListener('change', e => change({spacing: e.target.value}));
    byId('aspro-show-timestamps').addEventListener('change', e => change({show_timestamps: e.target.checked}));
    fillControls();
  }
  async function load() {
    if (loading || ready || !window.pywebview || !window.pywebview.api) return;
    loading = true;
    try {
      const cfg = await window.pywebview.api.get_config();
      if (!dirty && cfg && cfg[CONFIG_KEY]) prefs = normalize(cfg[CONFIG_KEY]);
      ready = true; applyRoot(); fillControls();
      if (dirty) persist(readLocal());
    } catch (_) { loading = false; }
  }
  const original = window.appendStaticMessage;
  if (typeof original !== 'function') throw new Error('appendStaticMessage is not available');
  window.appendStaticMessage = function (message) {
    const box = byId('chat-messages'), before = box ? box.children.length : 0;
    const result = original.apply(this, arguments);
    if (box && box.children.length > before) decorate(box.children[box.children.length - 1], message);
    return result;
  };
  addControls(); applyRoot();
  window.addEventListener('pywebviewready', load); load();
  window.AsproMessageDisplay = {version: 1, getPreferences: () => Object.assign({}, prefs), formatTime};
  window.__asproMessageDisplayVersion = 1;
})();
