const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../frontend/scripts/backup_schedule.js'), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));
function harness(api) {
  const nodes = [], timers = [], notices = [], events = {};
  function el(tag) {
    const n = {tag, children: [], style: {}, disabled: false, open: false, textContent: '', value: '', checked: false,
      appendChild(c) {this.children.push(c); return c;}, prepend(c) {this.children.unshift(c);},
      replaceChildren() {this.children = [];}, setAttribute(k, v) {this[k] = v;}, showModal() {this.open = true;}};
    nodes.push(n); return n;
  }
  const body = el('body'), bar = el('bar');
  const document = {readyState: 'complete', body, createElement: el, querySelector: () => bar};
  const ctx = {document, console, pywebview: api ? {api} : undefined, showToast: t => notices.push(t),
    addEventListener: (k, f) => {events[k] = f;}, setInterval: (fn, ms) => timers.push({fn, ms})};
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  return {ctx, nodes, notices, timers, events,
    byId: id => nodes.find(n => n.id === id),
    button: text => nodes.find(n => n.tag === 'button' && n.textContent === text),
    status: () => nodes.find(n => n.role === 'status').textContent,
    async open() {nodes.find(n => n.tag === 'button' && n.textContent === 'Backups').onclick(); await tick();}};
}
const settings = {ok: true, enabled: true, interval_hours: 24, keep: 7, intervals: [6, 12, 24, 72, 168], min_keep: 1, max_keep: 30,
  folder: 'data/backups', note: 'No attachments or provider keys.', last_status: 'Saved copy.', warning: '',
  backups: [{name: '<img onerror=bad>.json', size: 100}]};
(async () => {
  let calls = 0;
  let api = {run_backup_if_due: async () => {calls++; return {ok: true, ran: false};}, get_backup_settings: async () => settings};
  let h = harness(api); await tick();
  assert.equal(calls, 1); assert.equal(h.timers[0].ms, 1800000);
  h.timers[0].fn(); await tick(); assert.equal(calls, 2);
  console.log('PASS startup and half-hour schedule');
  await h.open(); assert.equal(h.byId('aspro-backups').open, true);
  assert.equal(h.byId('aspro-backup-enabled').checked, true); assert.equal(h.byId('aspro-backup-interval').value, '24');
  assert.ok(h.nodes.some(n => n.textContent.includes('No attachments')));
  assert.ok(h.nodes.some(n => n.textContent.includes('<img onerror=bad>'))); assert.ok(!h.nodes.some(n => n.tag === 'img'));
  console.log('PASS settings, limitations and file names rendered as plain text');
  let saved;
  api.set_backup_settings = async (...args) => {saved = args; return {ok: true, message: 'Saved settings.'};};
  h.byId('aspro-backup-enabled').checked = false; h.byId('aspro-backup-interval').value = '72'; h.byId('aspro-backup-keep').value = '3';
  await h.button('Save settings').onclick(); assert.deepEqual(saved, [false, 72, 3]); assert.equal(h.status(), 'Saved settings.');
  console.log('PASS chosen settings are sent exactly');
  api.run_backup_now = async () => ({ok: false, message: 'Disk full; older copies kept.'});
  await h.button('Back up now').onclick(); assert.equal(h.status(), 'Disk full; older copies kept.');
  console.log('PASS manual backup result remains visible after reload');
  api.open_backup_folder = async () => true;
  await h.button('Open backup folder').onclick(); assert.equal(h.status(), 'Opened backup folder.');
  console.log('PASS folder opening');
  for (const a of [undefined, {}, {get_backup_settings: async () => {throw Error('no');}}]) {
    h = harness(a); await h.open(); assert.match(h.status(), /unavailable/);
  }
  console.log('PASS unavailable backend does not break dialog');
  let release, count = 0;
  api.run_backup_now = () => new Promise(r => {count++; release = () => r({message: 'Done'});});
  h = harness(api); await h.open(); const pending = h.button('Back up now').onclick();
  await h.button('Back up now').onclick(); assert.equal(count, 1); assert.equal(h.button('Back up now').disabled, true);
  release(); await pending; assert.equal(h.button('Back up now').disabled, false);
  console.log('PASS duplicate manual clicks ignored');
  h = harness({run_backup_if_due: async () => ({ok: false, message: 'Problem'})}); await tick();
  h.timers[0].fn(); await tick(); assert.equal(h.notices.length, 1);
  console.log('PASS repeated identical failure notice suppressed');
  let older, reads = 0;
  h = harness({get_backup_settings: () => new Promise(r => {if (++reads === 1) older = () => r({...settings, folder: 'OLD'}); else r(settings);})});
  const first = h.open(); await h.open(); older(); await first; await tick();
  assert.ok(!h.nodes.some(n => n.textContent.startsWith('Folder: OLD')));
  console.log('PASS stale settings response discarded');
})().catch(e => {console.error(e); process.exitCode = 1;});
