/* Offline neural voices (Piper): download voices on demand and use them for Listen. Falls back to the existing voices. */
(function () {
  'use strict';
  const KEY = 'aspro_offline_voices_v1', CONFIG_KEY = 'offline_voice_preferences', LANGS = ['en', 'fr', 'ar'];
  const NAMES = {en: 'English', fr: 'French', ar: 'Arabic'};
  function normalize(raw) {
    raw = raw && typeof raw === 'object' ? raw : {}; const ids = raw.voices && typeof raw.voices === 'object' ? raw.voices : {};
    const voices = {}; for (const l of LANGS) voices[l] = typeof ids[l] === 'string' ? ids[l].slice(0, 100) : '';
    return {voices};
  }
  function cleanText(text, skipCode) {
    let t = String(text || '');
    if (skipCode !== false) t = t.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, ' ');
    else t = t.replace(/^\s*(?:```|~~~)[^\n]*$/gm, '');
    return t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' ').replace(/<[^>]*>/g, ' ')
      .replace(/^\s*\|?\s*[-:]+(?:\s*\|\s*[-:]+)+\s*\|?\s*$/gm, ' ').replace(/[*#_`~>]/g, '').replace(/\p{Extended_Pictographic}|\uFE0F/gu, '')
      .replace(/\|/g, ', ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }
  function guessLanguage(text) {
    if ((text.match(/[\u0600-\u06ff]/g) || []).length > (text.match(/[a-z]/gi) || []).length / 2) return 'ar';
    if (/[àâçéèêëîïôùûüœ]/i.test(text) || (text.match(/\b(bonjour|vous|nous|les|des|une|avec|pour|dans|est)\b/gi) || []).length >= 2) return 'fr';
    return 'en';
  }
  function splitText(text, max) {
    max = max || 350; const out = []; let rest = String(text || '').trim();
    while (rest.length > max) {
      let cut = -1; const head = rest.slice(0, max);
      for (const p of ['. ', '! ', '? ', '؟ ', '; ', '\n']) cut = Math.max(cut, head.lastIndexOf(p));
      if (cut < max / 3) cut = head.lastIndexOf(' ');
      if (cut < 1) cut = max; else cut += 1;
      out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest); return out;
  }
  // Returns the voice id to use for this language, or '' when the existing (Windows/browser) voices should be used.
  function chooseOfflineVoice(prefs, status, lang) {
    if (!status || !status.engine) return '';
    const id = prefs.voices[lang];
    return id && status.voices.some(v => v.id === id && v.lang === lang && v.installed) ? id : '';
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {normalize, cleanText, guessLanguage, splitText, chooseOfflineVoice};
  if (typeof document === 'undefined') return;
  let prefs = normalize({}), status = null, ready = false, dirty = false, saves = Promise.resolve(), generation = 0, audio = null, timer = null;
  try { prefs = normalize(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) {}
  const api = () => window.pywebview && window.pywebview.api, toast = t => { if (typeof showToast === 'function') showToast(t); };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) {}
    if (!ready) return;
    const snapshot = normalize(prefs);
    if (typeof globalConfig !== 'undefined' && globalConfig) globalConfig[CONFIG_KEY] = snapshot;
    saves = saves.catch(() => {}).then(() => window.pywebview.api.save_config({[CONFIG_KEY]: snapshot})).then(ok => { if (ok !== true) throw new Error('save failed'); }).catch(() => toast('Could not save the offline voice choice.'));
  }
  async function refreshStatus() {
    if (!api()) return null;
    try { status = await window.pywebview.api.offline_voices_status(); } catch (_) { status = null; }
    return status;
  }
  const panel = document.createElement('dialog'); panel.id = 'aspro-offline-voices'; panel.className = 'aspro-panel aspro-voice-dialog';
  function draw() {
    panel.replaceChildren();
    const form = document.createElement('form'); form.method = 'dialog';
    const head = el('header'); const closeBtn = el('button', '', '✕'); closeBtn.setAttribute('aria-label', 'Close offline voices'); head.append(el('h2', '', 'Offline voices'), closeBtn); form.appendChild(head); panel.appendChild(form);
    panel.appendChild(el('p', '', 'Neural voices that run on this computer. Each voice is downloaded once from the Piper voice library (Hugging Face) into the folder below; speaking sends nothing anywhere.'));
    if (!status) { panel.appendChild(el('p', '', 'Voice information is not available right now.')); return; }
    if (!status.engine) panel.appendChild(el('p', 'aspro-voice-warning', status.hint));
    for (const v of status.voices) {
      const row = el('div', 'aspro-voice-row'), info = el('span', 'aspro-voice-info');
      info.append(el('strong', '', v.label), el('small', '', NAMES[v.lang] + ' · about ' + v.size_mb + ' MB' + (v.installed ? ' · installed' : '')));
      if (v.downloading) info.appendChild(el('small', '', 'Downloading ' + Math.round(v.progress * 100) + '%'));
      if (v.error) info.appendChild(el('small', 'aspro-voice-warning', 'Download failed: ' + v.error));
      row.appendChild(info);
      if (v.installed) {
        const use = document.createElement('input'); use.type = 'checkbox'; use.checked = prefs.voices[v.lang] === v.id; use.disabled = !status.engine;
        use.addEventListener('change', () => { prefs.voices[v.lang] = use.checked ? v.id : ''; persist(); draw(); });
        const useLabel = el('label', 'aspro-inline'); useLabel.append(use, document.createTextNode(' Use for Listen'));
        const test = el('button', 'aspro-toolbar', 'Test'); test.type = 'button'; test.disabled = !status.engine;
        test.onclick = () => speak(v.lang === 'fr' ? 'Bonjour, ceci est un essai de la voix.' : v.lang === 'ar' ? 'مرحباً، هذا اختبار للصوت.' : 'Hello, this is a test of the offline voice.', v.id);
        const del = el('button', 'aspro-toolbar', 'Delete'); del.type = 'button';
        del.onclick = async () => { if (prefs.voices[v.lang] === v.id) { prefs.voices[v.lang] = ''; persist(); } await window.pywebview.api.offline_voice_delete(v.id); await refreshStatus(); draw(); };
        row.append(useLabel, test, del);
      } else if (!v.downloading) {
        const get = el('button', 'aspro-toolbar', 'Download'); get.type = 'button';
        get.onclick = async () => { const r = await window.pywebview.api.offline_voice_download(v.id); if (!r.ok) toast(r.message); await refreshStatus(); draw(); poll(); };
        row.appendChild(get);
      }
      panel.appendChild(row);
    }
    panel.appendChild(el('p', 'aspro-voice-note', 'Folder: ' + status.folder + '. Each voice has its own license; see the voice model cards at huggingface.co/rhasspy/piper-voices. If a language has no ticked voice, Listen keeps using the Windows/browser voices.'));
  }
  function poll() {
    clearInterval(timer);
    timer = setInterval(async () => {
      await refreshStatus();
      if (panel.open) draw();
      if (!status || !status.voices.some(v => v.downloading) || !panel.open) clearInterval(timer);
    }, 1000);
  }
  const player = document.createElement('div'); player.id = 'aspro-offline-player'; player.hidden = true;
  const playerText = el('span', '', 'Reading with an offline voice'), pause = el('button', 'aspro-toolbar', 'Pause'), stopBtn = el('button', 'aspro-toolbar', 'Stop');
  pause.type = stopBtn.type = 'button'; player.append(playerText, pause, stopBtn);
  function stop() { generation++; if (audio) { audio.pause(); audio = null; } player.hidden = true; pause.textContent = 'Pause'; }
  pause.onclick = () => { if (!audio) return; if (audio.paused) { audio.play(); pause.textContent = 'Pause'; } else { audio.pause(); pause.textContent = 'Resume'; } };
  stopBtn.onclick = stop;
  function playUrl(url, token) {
    return new Promise(resolve => {
      if (token !== generation) return resolve(false);
      audio = new Audio(url); audio.onended = () => resolve(true); audio.onerror = () => resolve(false);
      audio.play().catch(() => resolve(false));
    });
  }
  async function speak(text, voiceId) {
    stop(); const token = generation;
    const prefsVoice = typeof globalConfig !== 'undefined' && globalConfig && globalConfig.voice_preferences ? globalConfig.voice_preferences : {};
    const rate = Number(prefsVoice.rate) || 1, chunks = splitText(cleanText(text, prefsVoice.skipCode));
    if (!chunks.length) { toast('There is no readable text after removing formatting and code.'); return; }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    player.hidden = false; playerText.textContent = 'Preparing offline voice…';
    let next = window.pywebview.api.offline_voice_speak(chunks[0], voiceId, rate);
    for (let i = 0; i < chunks.length; i++) {
      const result = await next; if (token !== generation) return;
      if (!result || !result.ok) { stop(); toast('Offline voice failed: ' + ((result && result.error) || 'unknown error')); return; }
      if (i + 1 < chunks.length) next = window.pywebview.api.offline_voice_speak(chunks[i + 1], voiceId, rate);
      playerText.textContent = 'Reading with an offline voice · ' + (i + 1) + '/' + chunks.length;
      if (!(await playUrl(result.audio, token)) && token === generation) { stop(); toast('The audio could not be played.'); return; }
    }
    if (token === generation) stop();
  }
  async function load() {
    if (ready || !api()) return;
    try { const cfg = await window.pywebview.api.get_config(); if (!dirty && cfg && cfg[CONFIG_KEY]) prefs = normalize(cfg[CONFIG_KEY]); ready = true; await refreshStatus(); } catch (_) {}
  }
  function init() {
    if (window.__asproOfflineVoicesVersion) return;
    document.body.append(panel, player);
    const open = el('button', 'aspro-toolbar', 'Offline voices'); open.type = 'button'; open.style.cssText = 'width:100%;margin-top:6px';
    const slot = document.querySelector('aside > div:last-child'); if (slot) slot.appendChild(open);
    open.onclick = async () => { await refreshStatus(); draw(); if (!panel.open) panel.showModal(); poll(); };
    panel.addEventListener('close', () => clearInterval(timer));
    // Capture phase and registered before speech.js: takes over Listen only when an offline voice is ticked for the text's language.
    document.addEventListener('click', event => {
      const target = event.target.closest('[data-action="listen-text"]');
      if (!target || target.closest('.prose')) return;
      let text = ''; try { text = decodeURIComponent(target.getAttribute('data-payload') || ''); } catch (_) { return; }
      const clean = cleanText(text, true), voice = chooseOfflineVoice(prefs, status, guessLanguage(clean));
      if (!voice) { stop(); return; }
      event.preventDefault(); event.stopImmediatePropagation(); speak(text, voice);
    }, true);
    window.addEventListener('beforeunload', stop);
    window.addEventListener('pywebviewready', load); load();
    window.__asproOfflineVoicesVersion = 1;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true}); else init();
})();
