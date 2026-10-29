/* Opt-in scheduled chat backups; only active while the app window is open. */
(function () {
  'use strict';
  if (window.__asproBackupScheduleVersion) return;
  const api = () => window.pywebview && window.pywebview.api;
  const toast = text => { if (typeof window.showToast === 'function') window.showToast(text); };
  let lastFailure = '', checking = false;
  async function check() {
    const a = api();
    if (checking || !a || typeof a.run_backup_if_due !== 'function') return;
    checking = true;
    try {
      const r = await a.run_backup_if_due();
      if (r && r.ok === false) {
        if (r.message !== lastFailure) toast('Automatic backup problem: ' + r.message);
        lastFailure = r.message;
      } else {
        lastFailure = '';
        if (r && r.ran) toast(r.message);
      }
    } catch (_) { /* Bridge may not be ready yet. */ }
    finally { checking = false; }
  }
  function make(tag, text) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function init() {
    const dialog = make('dialog'); dialog.id = 'aspro-backups'; dialog.className = 'aspro-panel';
    dialog.style.width = 'min(640px, calc(100vw - 32px))';
    const form = make('form'); form.method = 'dialog';
    const header = make('header'); header.appendChild(make('h2', 'Backups'));
    const close = make('button', 'Close'); close.setAttribute('aria-label', 'Close backups');
    header.appendChild(close); form.appendChild(header); dialog.appendChild(form);
    const note = make('p'), folder = make('p'), status = make('p'); status.setAttribute('role', 'status');
    const on = make('input'); on.type = 'checkbox'; on.id = 'aspro-backup-enabled';
    const label = make('label', 'Automatic backups while the app is open '); label.appendChild(on);
    const interval = make('select'); interval.id = 'aspro-backup-interval';
    const keep = make('select'); keep.id = 'aspro-backup-keep';
    const il = make('label', 'How often'); il.appendChild(interval);
    const kl = make('label', 'Backups to keep'); kl.appendChild(keep);
    const hint = make('p', 'Older scheduled copies beyond this limit are deleted only after a new backup verifies successfully.');
    const list = make('div'); list.style.cssText = 'font:12px monospace;overflow-wrap:anywhere';
    [note, label, il, kl, hint, folder, status, list].forEach(n => dialog.appendChild(n));
    let serial = 0, busy = false;
    function problem(text) { status.textContent = text; }
    async function load() {
      const ticket = ++serial; problem('Loading...');
      try {
        const r = await api().get_backup_settings();
        if (ticket !== serial) return;
        if (!r || !r.ok) throw Error('unavailable');
        note.textContent = r.note; on.checked = r.enabled;
        interval.replaceChildren(); keep.replaceChildren();
        r.intervals.forEach(h => { const o = make('option', h === 24 ? 'Once a day' : 'Every ' + h + ' hours'); o.value = String(h); interval.appendChild(o); });
        for (let n = r.min_keep; n <= r.max_keep; n++) { const o = make('option', String(n)); o.value = String(n); keep.appendChild(o); }
        interval.value = String(r.interval_hours); keep.value = String(r.keep);
        folder.textContent = 'Folder: ' + r.folder + '. ' + (r.last_status || 'No backup yet.');
        list.replaceChildren();
        r.backups.forEach(b => list.appendChild(make('p', b.name + ' (' + b.size + ' bytes)')));
        if (!r.backups.length) list.appendChild(make('p', 'No backups yet.'));
        problem(r.warning || '');
      } catch (_) { if (ticket === serial) problem('Backup settings unavailable. Update both backend and frontend files.'); }
    }
    const buttons = [];
    function button(text, task) {
      const b = make('button', text); b.type = 'button'; b.className = 'aspro-toolbar'; buttons.push(b);
      b.onclick = async () => {
        if (busy) return;
        busy = true; buttons.forEach(x => { x.disabled = true; });
        try { await task(); }
        catch (_) { problem('This backup operation failed. Check folder permissions and disk space.'); }
        finally { busy = false; buttons.forEach(x => { x.disabled = false; }); }
      };
      dialog.appendChild(b);
    }
    button('Save settings', async () => {
      const r = await api().set_backup_settings(on.checked, Number(interval.value), Number(keep.value));
      if (r.ok) { await load(); check(); }
      problem(r.message);
    });
    button('Back up now', async () => {
      problem('Backing up...'); const r = await api().run_backup_now();
      await load(); problem(r.message);
    });
    button('Open backup folder', async () => problem(await api().open_backup_folder() ? 'Opened backup folder.' : 'Could not open backup folder.'));
    document.body.appendChild(dialog);
    const bar = document.querySelector('main > header > div:last-child');
    if (bar) {
      const b = make('button', 'Backups'); b.type = 'button'; b.className = 'aspro-toolbar';
      b.onclick = () => { if (!dialog.open) dialog.showModal(); load(); }; bar.prepend(b);
    }
    window.addEventListener('pywebviewready', check);
    check(); window.setInterval(check, 30 * 60 * 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true}); else init();
  window.__asproBackupScheduleVersion = 1;
})();
