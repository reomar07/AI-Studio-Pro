const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../frontend/scripts/usage_summary.js'), 'utf8');

function makeElement(tag) {
  const node = {tagName: String(tag).toUpperCase(), children: [], style: {}, listeners: {}, attributes: {}, hidden: false, open: false, title: '', _text: ''};
  Object.defineProperty(node, 'textContent', {get() {return node.children.length ? node.children.map(c => c.textContent).join('') : node._text;}, set(v) {node._text = String(v); node.children = [];}});
  node.appendChild = child => {node.children.push(child); node._text = ''; return child;};
  node.prepend = child => {node.children.unshift(child); return child;};
  node.replaceChildren = () => {node.children = [];};
  node.setAttribute = (k, v) => {node.attributes[k] = v;};
  node.addEventListener = (type, fn) => {(node.listeners[type] = node.listeners[type] || []).push(fn);};
  node.click = () => (node.listeners.click || []).forEach(fn => fn());
  if (tag === 'dialog') node.showModal = () => {node.open = true;};
  return node;
}
function find(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  node.children.forEach(child => find(child, predicate, found));
  return found;
}
function harness({api, withToolbar = true} = {}) {
  const bar = makeElement('div'), body = makeElement('body');
  const document = {readyState: 'complete', createElement: makeElement, body,
    querySelector: selector => (withToolbar && selector === 'main > header > div:last-child' ? bar : null), addEventListener() {}};
  const ctx = {document, console, window: {pywebview: api ? {api} : undefined}};
  ctx.window.document = document;
  vm.createContext(ctx); vm.runInContext(source, ctx);
  return {ctx, bar, body, dialog: () => body.children.find(c => c.tagName === 'DIALOG'),
    button: () => bar.children.find(c => c.textContent === 'Token use'),
    rows: () => find(body, n => n.tagName === 'TR').map(r => r.children.map(c => c.textContent))};
}
const summary = {ok: true, note: 'Reported numbers come from your provider.', warning: '', today: '2026-10-25',
  totals: {replies: 5, images: 1, reported_prompt: 12345, reported_completion: 80, estimated_completion: 20},
  days: [{day: '2026-10-25', replies: 3, images: 1, reported_prompt: 12345, reported_completion: 50, estimated_completion: 20, models: [{model: 'm<b>1', replies: 3}]},
         {day: '2026-10-24', replies: 2, images: 0, reported_prompt: 0, reported_completion: 30, estimated_completion: 0, models: []}]};

(async () => {
  let h = harness({api: {get_usage_summary: async days => {h.days = days; return summary;}}});
  assert.equal(h.ctx.window.__asproUsageSummaryVersion, 1);
  assert.ok(h.button(), 'toolbar button is added'); assert.ok(h.dialog(), 'dialog is added');
  assert.equal(h.dialog().id, 'aspro-usage');
  h.button().click(); await new Promise(r => setTimeout(r, 0));
  assert.equal(h.dialog().open, true); assert.equal(h.days, 14);
  const rows = h.rows();
  assert.equal(rows[0].join('|'), 'Day|Replies|Reported in|Reported out|Estimated out');
  assert.equal(rows[1][0], '2026-10-25'); assert.match(rows[1][1], /^3 \(1 pictures\)$/);
  assert.match(rows[1][2], /^12\D?345$/); assert.equal(rows[1][3], '50'); assert.equal(rows[1][4], '20');
  assert.deepEqual(rows[2].slice(0, 2), ['2026-10-24', '2']);
  assert.equal(rows[3][0], 'Total'); assert.equal(rows[3][3], '80');
  const dayRow = find(h.body, n => n.tagName === 'TR')[1];
  assert.equal(dayRow.title, 'm<b>1: 3 replies');
  assert.equal(find(h.body, n => n.tagName === 'B').length, 0, 'model names are shown as text only');
  console.log('PASS opens, loads 14 days and shows reported and estimated numbers separately');

  h = harness({api: {get_usage_summary: async () => ({ok: true, note: 'n', days: [], totals: {}, warning: ''})}});
  h.button().click(); await new Promise(r => setTimeout(r, 0));
  const status = find(h.body, n => n.attributes.role === 'status')[0];
  assert.match(status.textContent, /No replies have been counted yet/);
  assert.equal(find(h.body, n => n.tagName === 'TABLE')[0].hidden, true);
  console.log('PASS empty history shows a plain message');

  h = harness({api: {get_usage_summary: async () => ({ok: true, note: 'n', days: [], totals: {}, warning: 'The saved usage file could not be read.'})}});
  h.button().click(); await new Promise(r => setTimeout(r, 0));
  assert.match(find(h.body, n => n.attributes.role === 'status')[0].textContent, /could not be read.*No replies/);
  console.log('PASS a damaged-file warning is shown');

  for (const [label, api] of [['missing backend method', {}], ['no pywebview', undefined], ['backend error', {get_usage_summary: async () => {throw new Error('boom');}}]]) {
    h = harness({api}); h.button().click(); await new Promise(r => setTimeout(r, 0));
    assert.match(find(h.body, n => n.attributes.role === 'status')[0].textContent, /unavailable in this app version/, label);
  }
  h = harness({api: {get_usage_summary: async () => ({ok: false, message: 'The token summary could not be read.'})}});
  h.button().click(); await new Promise(r => setTimeout(r, 0));
  assert.match(find(h.body, n => n.attributes.role === 'status')[0].textContent, /could not be read/);
  console.log('PASS missing or failing backend shows a clear message instead of breaking the page');

  let calls = 0, release;
  h = harness({api: {get_usage_summary: () => new Promise(resolve => {calls++; if (calls === 1) release = () => resolve({...summary, days: [{...summary.days[0], day: 'OLD'}]}); else resolve(summary);})}});
  h.button().click(); h.button().click(); await new Promise(r => setTimeout(r, 0)); release(); await new Promise(r => setTimeout(r, 0));
  assert.ok(!JSON.stringify(h.rows()).includes('OLD'), 'a slower older request must not overwrite newer data');
  console.log('PASS a slow older response cannot overwrite newer numbers');

  h = harness({api: {get_usage_summary: async () => summary}, withToolbar: false});
  assert.equal(h.ctx.window.__asproUsageSummaryVersion, 1); assert.ok(h.dialog());
  console.log('PASS a missing toolbar does not stop the module from loading');
})().catch(error => {console.error(error); process.exitCode = 1;});
