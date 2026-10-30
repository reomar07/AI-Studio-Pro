/* Workspace index controls: rebuild or clear the search index of the attached folder. */
(function () {
  'use strict';
  function describe(s) {
    if (!s || !s.attached) return 'No folder index';
    if (s.indexing) return 'Scanning…';
    if (!s.chunks) return 'No readable files found';
    return s.chunks + ' passages from ' + s.files + ' file' + (s.files === 1 ? '' : 's');
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {describe};
  if (typeof document === 'undefined') return;
  const toast = text => { if (typeof showToast === 'function') showToast(text); };
  function init() {
    const badge = document.getElementById('workspace-badge');
    if (!badge || document.getElementById('aspro-index-controls')) return;
    const box = document.createElement('span'); box.id = 'aspro-index-controls'; box.className = 'aspro-index-controls';
    const status = document.createElement('span'); status.id = 'aspro-index-status'; status.setAttribute('aria-live', 'polite');
    function button(label, title) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'aspro-index-button'; b.textContent = label; b.title = title; return b;
    }
    const rebuild = button('↻ Rebuild', 'Scan the folder again (use this after files changed)');
    const clear = button('Clear index', 'Forget this folder\'s search index. Your files are not changed.');
    box.append(status, rebuild, clear);
    badge.insertBefore(box, badge.querySelector('button'));
    let current = null;
    async function refresh() {
      if (badge.classList.contains('hidden') || !window.pywebview || !window.pywebview.api) return;
      try {
        current = await window.pywebview.api.workspace_index_status();
        status.textContent = describe(current);
        rebuild.disabled = !current.attached || current.indexing;
        clear.disabled = !current.attached;
      } catch (_) { status.textContent = ''; }
    }
    rebuild.addEventListener('click', async () => {
      try {
        const result = await window.pywebview.api.rebuild_workspace_index();
        if (!result || !result.ok) toast((result && result.message) || 'The index could not be rebuilt.');
      } catch (_) { toast('The index could not be rebuilt.'); }
      refresh();
    });
    clear.addEventListener('click', async () => {
      if (!confirm('Clear the search index for this folder?\n\nYour files are not changed. You can attach the folder again later.')) return;
      try {
        await window.pywebview.api.clear_workspace_index();
        if (typeof clearWorkspace === 'function') clearWorkspace();
      } catch (_) { toast('The index could not be cleared.'); }
      refresh();
    });
    setInterval(refresh, 2000);
    refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true}); else init();
  window.__asproWorkspaceIndexVersion = 1;
})();
