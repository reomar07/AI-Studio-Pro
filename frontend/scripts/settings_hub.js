/* Consolidate settings entry points without replacing their existing handlers. */
(function () {
  'use strict';
  if (window.__asproSettingsHubVersion) return;
  const sidebar = document.querySelector('aside > div:last-child');
  const toolbar = document.querySelector('main > header > div:last-child');
  if (!sidebar || !toolbar) throw new Error('Settings hub: application layout unavailable');
  const make = (tag, text) => { const n = document.createElement(tag); if (text) n.textContent = text; return n; };
  const hub = make('dialog'); hub.id = 'aspro-settings-hub'; hub.className = 'aspro-panel';
  hub.style.cssText = 'width:min(540px,calc(100vw - 32px));max-height:85vh;overflow:auto';
  const form = make('form'); form.method = 'dialog';
  const header = make('header'); header.appendChild(make('h2', 'Settings'));
  const close = make('button', 'Close'); close.setAttribute('aria-label', 'Close settings'); header.appendChild(close); form.appendChild(header); hub.appendChild(form); hub.appendChild(form);
  const sections = new Map();
  for (const [key, title] of [['appearance','Appearance & web search'], ['providers','Providers & models'], ['voice','Voice & playback'], ['data','Backups & usage'], ['help','Help']]) {
    const section = make('section'); section.style.cssText = 'border-top:1px solid var(--ui-border);padding:10px 0';
    const heading = make('h3', title); heading.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:8px'; section.appendChild(heading);
    const row = make('div'); row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap'; section.appendChild(row); sections.set(key,row); hub.appendChild(section);
  }
  const routes = new Map([['Appearance','appearance'],['? Shortcuts','help'],['Token use','data'],['Backups','data'],['Offline voices','voice'],['Voice & playback','voice']]);
  const moves = [];
  for (const button of [...toolbar.querySelectorAll('button'), ...sidebar.querySelectorAll('button')]) {
    const key = routes.get(button.textContent.trim()); if (key) moves.push([button,key]);
  }
  const provider = sidebar.querySelector('button[onclick="toggleGlobalSettings()"]');
  if (!provider) throw new Error('Settings hub: provider settings button unavailable');
  const opener = make('button','Settings'); opener.type = 'button'; opener.className = provider.className;
  opener.setAttribute('aria-haspopup','dialog');
  provider.parentNode.insertBefore(opener,provider);
  moves.push([provider,'providers']);
  const theme = sidebar.querySelector('button[onclick="toggleTheme()"]'); if (theme) moves.push([theme,'appearance']);
  document.body.appendChild(hub);
  for (const [button,key] of moves) {
    sections.get(key).appendChild(button);
    if (button === provider) button.textContent = 'Providers & models';
    button.style.cssText = 'width:auto;margin:0;padding:7px 11px;border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-surface);color:var(--ui-text);font-size:13px';
    button.addEventListener('click', () => { if(hub.open) hub.close(); }, true);
  }
  opener.addEventListener('click', () => { if(!hub.open) hub.showModal(); });
  const chatOptions = document.querySelector('main > footer button[onclick="toggleChatSettings()"]');
  if(chatOptions) { chatOptions.textContent = 'Chat options'; chatOptions.title = 'Settings for this conversation only'; }
  const exports = [...toolbar.querySelectorAll('button')].filter(b => (b.getAttribute('onclick') || '').startsWith('exportChatLocal('));
  if(exports.length) {
    const menu = make('details'); menu.style.cssText = 'position:relative';
    const summary = make('summary','Export'); summary.style.cssText = 'cursor:pointer;font-size:12px;padding:5px 8px'; menu.appendChild(summary);
    const choices = make('div'); choices.style.cssText = 'position:absolute;right:0;top:100%;display:flex;gap:6px;padding:8px;background:var(--ui-sidebar);border:1px solid var(--ui-border);border-radius:7px;z-index:100';
    for(const b of exports) { choices.appendChild(b); b.addEventListener('click',() => {menu.open=false;}); }
    menu.appendChild(choices); toolbar.appendChild(menu);
    const label = [...toolbar.querySelectorAll('span')].find(n => n.textContent.trim() === 'Export:'); if(label) label.remove();
  }
  const badge = document.getElementById('aspro-feature-status');
  // Called only after every earlier module initialized; failure in this module leaves the error badge visible.
  if(badge) setTimeout(() => { if(window.__asproFeaturesReady && !window.__asproFeaturesError) badge.hidden=true; }, 3000);
  window.__asproSettingsHubVersion = 1;
})();
