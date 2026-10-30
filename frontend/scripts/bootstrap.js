/* Load interface modules sequentially; offline Listen interception must precede speech.js. */
if (window.tailwind) window.tailwind.config = {darkMode: 'class'};
(function () {
  'use strict';
  const errors = [];
  window.addEventListener('error', e => { if (String(e.filename || '').includes('frontend/scripts/')) errors.push(e.message || 'Script error'); });
  async function start() {
    if (document.getElementById('aspro-feature-status')) return;
    const badge = document.createElement('button');
    badge.id = 'aspro-feature-status'; badge.type = 'button'; badge.textContent = 'Web/index/voices: loading';
    badge.style.cssText = 'position:fixed;top:48px;right:12px;z-index:90;padding:4px 9px;border:1px solid #64748b;border-radius:7px;background:#1e293b;color:#fff;font:11px Segoe UI,Arial;cursor:pointer';
    document.body.appendChild(badge);
    function loadStyle(file) {
      return new Promise((resolve, reject) => {
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'frontend/styles/' + file + '?integration=1';
        link.onload = resolve; link.onerror = () => reject(new Error('Could not load ' + file)); document.head.appendChild(link);
      });
    }
    function loadScript(file) {
      return new Promise((resolve, reject) => {
        const s = document.createElement('script'); s.src = 'frontend/scripts/' + file + '?integration=1';
        s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + file)); document.body.appendChild(s);
      });
    }
    try {
      for (const file of ['themes.css', 'message_display.css', 'feature_panels.css']) await loadStyle(file);
      await loadScript('appearance.js');
      if (!document.getElementById('aspro-preferences') || !document.documentElement.dataset.asproTheme) throw new Error('Appearance initialization failed');
      const modules = [
        ['workspace_index.js', () => window.__asproWorkspaceIndexVersion === 1],
        ['offline_voices.js', () => window.__asproOfflineVoicesVersion === 1],
        ['context_menu.js', () => window.__asproContextMenuVersion === 2],
        ['speech.js', () => !!window.__asproVoiceReady],
        ['spelling.js', () => !!window.AsproSpelling && window.AsproSpelling.version === 2],
        ['model_favorites.js', () => window.__asproModelFavoritesVersion === 1],
        ['usage_summary.js', () => window.__asproUsageSummaryVersion === 1],
        ['backup_schedule.js', () => window.__asproBackupScheduleVersion === 1],
        ['chat_tags.js', () => window.__asproChatTagsVersion === 1],
        ['message_display.js', () => window.__asproMessageDisplayVersion === 1],
        ['web_pages.js', () => window.__asproWebPagesVersion === 1]
      ];
      for (const [file, check] of modules) {
        await loadScript(file);
        if (!check()) throw new Error(file + ' did not initialize. Replace the whole frontend folder.');
      }
      badge.textContent = 'Web/index/voices: ready'; badge.dataset.spellingPreview = '2'; badge.style.background = '#14532d';
      badge.title = 'Interface modules loaded, including index controls, page selection and offline voice controls. Voice engine installation, downloads and playback must be checked separately.';
      badge.onclick = () => { const d = document.getElementById('aspro-preferences'); if (d && !d.open) d.showModal(); };
      window.__asproFeaturesReady = true;
    } catch (error) {
      badge.textContent = 'Preview startup failed (click)'; badge.style.background = '#7f1d1d';
      const detail = String(error.message || error) + '\n' + errors.join('\n') + '\n\nPage: ' + location.href;
      badge.onclick = () => alert(detail); badge.title = detail; console.error('Preview:', detail); window.__asproFeaturesError = detail;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();
})();
