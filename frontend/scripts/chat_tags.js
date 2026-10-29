/* Sidebar-only chat tags. The original renderer always receives the full history. */
(function () {
  'use strict';
  if (window.AsproChatTags) return;
  function init() {
    const original = window.renderHistoryItems;
    if (typeof original !== 'function') return;
    const api = () => window.pywebview && window.pywebview.api;
    const make = (tag, text) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
    let index = {chats: {}, tags: []}, selected = '', ready = false, sequence = 0, pending = Promise.resolve();
    const controls = make('div'); controls.id = 'aspro-tag-controls'; controls.className = 'px-3 mb-2';
    const label = make('label', 'Filter chats by tag'); label.style.fontSize = '11px';
    const select = make('select'); select.id = 'aspro-tag-filter'; select.setAttribute('aria-label', 'Filter chats by tag');
    select.style.cssText = 'display:block;width:100%;padding:4px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);font-size:12px';
    const status = make('p'); status.style.fontSize = '11px'; status.setAttribute('role', 'status');
    label.appendChild(select); controls.appendChild(label); controls.appendChild(status);
    const anchor = document.getElementById('search-container');
    if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(controls, anchor.nextSibling);
    const dialog = make('dialog'); dialog.id = 'aspro-tag-editor'; dialog.className = 'aspro-panel';
    const form = make('form'); form.method = 'dialog';
    const title = make('h2', 'Chat tags'), close = make('button', 'Close'); form.appendChild(title); form.appendChild(close); dialog.appendChild(form);
    dialog.appendChild(make('p', 'Up to eight tags, 32 characters each. Separate with commas. Tags ignore case. Leave empty to remove all tags.'));
    const field = make('input'); field.id = 'aspro-chat-tags'; field.type = 'text'; field.setAttribute('aria-label', 'Chat tags'); field.style.width = '100%';
    const message = make('p'); message.setAttribute('role', 'status');
    const save = make('button', 'Save tags'); save.type = 'button'; save.className = 'aspro-toolbar';
    dialog.appendChild(field); dialog.appendChild(message); dialog.appendChild(save); document.body.appendChild(dialog);
    let editing = null, editSequence = 0, saving = false;
    dialog.addEventListener('close', () => { editSequence++; editing = null; saving = false; });
    function names(id) { const value = index.chats[id]; return Array.isArray(value) ? value : []; }
    async function edit(id, caption) {
      const ticket = ++editSequence; editing = id; saving = false; save.disabled = true; field.value = '';
      title.textContent = 'Tags for ' + caption; message.textContent = 'Loading...';
      if (!dialog.open) dialog.showModal();
      try {
        const r = await api().get_chat_tags(id);
        if (ticket !== editSequence) return;
        if (!r || !r.ok) { message.textContent = r && r.message || 'Tags unavailable.'; return; }
        field.value = r.tags.join(', '); message.textContent = ''; save.disabled = false; field.focus();
      } catch (_) { if (ticket === editSequence) message.textContent = 'Tags could not be loaded.'; }
    }
    function applyRows() {
      let visible = 0, pinned = 0;
      for (const listId of ['history-list', 'pinned-list']) {
        const list = document.getElementById(listId); if (!list) continue;
        for (const row of Array.from(list.children)) {
          const span = row.querySelector('[data-title-for]'); if (!span) continue;
          const id = span.getAttribute('data-title-for'), tags = names(id);
          const show = !selected || (selected === 'untagged' ? tags.length === 0 : tags.includes(selected.slice(4)));
          row.style.display = show ? '' : 'none'; if (show) { visible++; if (listId === 'pinned-list') pinned++; }
          let button = row.querySelector('[data-aspro-tag-button]');
          if (!button) {
            button = make('button'); button.type = 'button'; button.setAttribute('data-aspro-tag-button', '1');
            button.className = 'text-blue-600 dark:text-blue-400'; button.style.cssText = 'max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;flex-shrink:0';
            button.onclick = event => { event.stopPropagation(); edit(id, span.textContent || id); }; row.appendChild(button);
          }
          button.disabled = !ready; button.textContent = tags.length ? '# ' + tags[0] + (tags.length > 1 ? ' +' + (tags.length - 1) : '') : '#';
          button.title = tags.length ? 'Edit tags: ' + tags.join(', ') : 'Add tags'; button.setAttribute('aria-label', 'Edit tags for ' + (span.textContent || id));
        }
      }
      const section = document.getElementById('pinned-section'); if (section) section.classList.toggle('hidden', pinned === 0);
      if (ready) status.textContent = selected && !visible ? 'No chats match this tag and search.' : '';
    }
    function options() {
      select.replaceChildren();
      for (const [value, text] of [['', 'All chats'], ['untagged', 'Untagged chats'], ...index.tags.map(t => ['tag:' + t.name, t.name + ' (' + t.count + ')'])]) {
        const o = make('option', text); o.value = value; select.appendChild(o);
      }
      if (selected.startsWith('tag:') && !index.tags.some(t => 'tag:' + t.name === selected)) selected = '';
      select.value = selected; select.disabled = !ready;
    }
    function refresh() {
      const ticket = ++sequence;
      pending = (async () => {
        try {
          const r = await api().get_chat_tag_index();
          if (ticket !== sequence) return;
          if (!r || !r.ok || !r.chats || !Array.isArray(r.tags)) throw Error('unavailable');
          index = r; ready = true; options(); applyRows();
        } catch (_) {
          if (ticket !== sequence) return;
          index = {chats: {}, tags: []}; selected = ''; ready = false; options(); applyRows(); status.textContent = 'Tags unavailable. Existing chats are unchanged.';
        }
      })();
      return pending;
    }
    select.onchange = () => { selected = select.value; applyRows(); };
    save.onclick = async () => {
      if (!editing || saving) return;
      const id = editing, ticket = editSequence, tags = field.value.trim() ? field.value.split(',').map(t => t.trim()).filter(Boolean) : [];
      saving = true; save.disabled = true;
      try {
        const r = await api().set_chat_tags(id, tags);
        if (r && r.ok) { await loadHistory(); await refresh(); }
        if (ticket !== editSequence) return;
        if (r && r.ok) { field.value = r.tags.join(', '); message.textContent = 'Tags saved.'; }
        else message.textContent = r && r.message || 'Tags could not be saved.';
      } catch (_) { if (ticket === editSequence) message.textContent = 'Tags could not be saved.'; }
      finally { if (ticket === editSequence) { saving = false; save.disabled = false; } }
    };
    window.renderHistoryItems = function () { const result = original.apply(this, arguments); applyRows(); refresh(); return result; };
    window.AsproChatTags = {version: 1, whenIdle: () => pending};
    options(); window.addEventListener('pywebviewready', refresh); refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true}); else init();
  window.__asproChatTagsVersion = 1;
})();
