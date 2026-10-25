/* Daily token-use summary (read-only). Loaded by bootstrap.js after the other interface modules. */
(function () {
  'use strict';
  if (window.__asproUsageSummaryVersion) return;
  const EMPTY = 'No replies have been counted yet. Numbers appear after your next answer.';
  let initialized = false;

  function make(tag, text, props) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (props) Object.keys(props).forEach(key => { node[key] = props[key]; });
    return node;
  }
  function number(value) {
    const n = Number(value);
    return (Number.isFinite(n) ? n : 0).toLocaleString();
  }

  function init() {
    if (initialized) return;
    initialized = true;
    const dialog = make('dialog', undefined, {id: 'aspro-usage', className: 'aspro-panel'});
    dialog.style.width = 'min(680px, calc(100vw - 32px))';
    const form = make('form'); form.method = 'dialog';
    const header = make('header');
    header.appendChild(make('h2', 'Token use'));
    const close = make('button', '\u2715'); close.setAttribute('aria-label', 'Close token use');
    header.appendChild(close); form.appendChild(header); dialog.appendChild(form);
    const note = make('p');
    const status = make('p'); status.setAttribute('role', 'status');
    const table = make('table'); table.style.width = '100%'; table.style.borderCollapse = 'collapse'; table.style.fontSize = '13px';
    const head = make('thead'), headRow = make('tr');
    ['Day', 'Replies', 'Reported in', 'Reported out', 'Estimated out'].forEach((label, index) => {
      const th = make('th', label); th.style.padding = '4px 6px'; th.style.textAlign = index ? 'right' : 'left'; headRow.appendChild(th);
    });
    head.appendChild(headRow);
    const body = make('tbody'), foot = make('tfoot');
    table.appendChild(head); table.appendChild(body); table.appendChild(foot);
    const refresh = make('button', 'Refresh', {type: 'button', className: 'aspro-toolbar'});
    dialog.appendChild(note); dialog.appendChild(table); dialog.appendChild(status); dialog.appendChild(refresh);

    function cells(row, values, bold) {
      values.forEach((value, index) => {
        const td = make('td', value);
        td.style.padding = '4px 6px'; td.style.textAlign = index ? 'right' : 'left';
        if (bold) td.style.fontWeight = '600';
        row.appendChild(td);
      });
    }
    function problem(text) {
      body.replaceChildren(); foot.replaceChildren();
      table.hidden = true; note.textContent = ''; status.textContent = text;
    }
    function render(summary) {
      body.replaceChildren(); foot.replaceChildren();
      note.textContent = String(summary.note || '');
      const days = Array.isArray(summary.days) ? summary.days : [];
      if (!days.length) { table.hidden = true; status.textContent = summary.warning ? String(summary.warning) + ' ' + EMPTY : EMPTY; return; }
      table.hidden = false;
      days.forEach(day => {
        const row = make('tr');
        const models = Array.isArray(day.models) ? day.models : [];
        row.title = models.map(m => String(m.model) + ': ' + number(m.replies) + ' replies').join('\n');
        const images = Number(day.images) > 0 ? ' (' + number(day.images) + ' pictures)' : '';
        cells(row, [String(day.day), number(day.replies) + images, number(day.reported_prompt), number(day.reported_completion), number(day.estimated_completion)]);
        body.appendChild(row);
      });
      const totals = summary.totals || {};
      const totalRow = make('tr');
      cells(totalRow, ['Total', number(totals.replies), number(totals.reported_prompt), number(totals.reported_completion), number(totals.estimated_completion)], true);
      foot.appendChild(totalRow);
      status.textContent = summary.warning ? String(summary.warning) : '';
    }
    let ticket = 0;
    async function load() {
      const mine = ++ticket;
      status.textContent = 'Loading\u2026';
      try {
        const api = window.pywebview && window.pywebview.api;
        if (!api || typeof api.get_usage_summary !== 'function') throw new Error('unavailable');
        const result = await api.get_usage_summary(14);
        if (mine !== ticket) return;
        if (!result || result.ok !== true) { problem((result && result.message) || 'The token summary could not be read.'); return; }
        render(result);
      } catch (error) {
        if (mine === ticket) problem('Token summary is unavailable in this app version. Replace both the backend and frontend files.');
      }
    }
    refresh.addEventListener('click', load);
    const bar = document.querySelector('main > header > div:last-child');
    if (bar) {
      const open = make('button', 'Token use', {type: 'button', className: 'aspro-toolbar'});
      open.addEventListener('click', () => {
        if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
        load();
      });
      bar.prepend(open);
    }
    document.body.appendChild(dialog);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true}); else init();
  window.__asproUsageSummaryVersion = 1;
})();
