/* Real app.js renderer, simulated DOM and bridge; no network or user data. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'frontend/scripts/app.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'frontend/scripts/chat_tags.js'), 'utf8');
const clone = x => JSON.parse(JSON.stringify(x));
const tick = () => new Promise(r => setTimeout(r, 0));
function harness(delayed = false) {
  const ids = new Map(), events = {}, saves = [], notices = [];
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.dataset = {}; this.value = ''; this.open = false; this._text = ''; const s = new Set();
      this.classList = {add: (...xs) => xs.forEach(x => s.add(x)), remove: (...xs) => xs.forEach(x => s.delete(x)), contains: x => s.has(x),
        toggle(x, force) {const yes = force === undefined ? !s.has(x) : force; if (yes) s.add(x); else s.delete(x); return yes;}}; }
    set id(v) {this._id = v; ids.set(v, this);} get id() {return this._id;}
    set textContent(v) {this._text = String(v); this.children = [];} get textContent() {return this._text + this.children.map(n => n.textContent).join('');}
    set innerText(v) {this.textContent = v;} get innerText() {return this.textContent;}
    set innerHTML(v) {this.html = v; this._text = ''; this.children = []; const m = String(v).match(/data-title-for="([^"]*)"/);
      if (m) {const n = new Node('span'); n.setAttribute('data-title-for', m[1]); n.textContent = String(v).slice(m.index).match(/>([^<]*)</)[1]; this.appendChild(n);} }
    get innerHTML() {return this.html || '';}
    appendChild(n) {n.parentElement = this; this.children.push(n); return n;}
    insertBefore(n, ref) {n.parentElement = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, n);}
    get nextSibling() {return this.parentElement && this.parentElement.children[this.parentElement.children.indexOf(this) + 1];}
    replaceChildren() {this.children = []; this._text = '';}
    setAttribute(k, v) {this.attrs[k] = v;} getAttribute(k) {return this.attrs[k];}
    querySelector(q) {const key = q.slice(1, -1); for (const n of this.children) {if (Object.hasOwn(n.attrs, key)) return n; const found = n.querySelector(q); if (found) return found;} return null;}
    querySelectorAll() {return [];}
    addEventListener(k, f) {this['on' + k] = f;}
    showModal() {this.open = true;} close() {this.open = false; if (this.onclose) this.onclose();}
    focus() {} remove() {}
  }
  const document = {readyState: 'complete', body: new Node('body'), documentElement: new Node('html'), createElement: t => new Node(t),
    getElementById(id) {if (id.startsWith('aspro-')) return ids.get(id) || null; if (!ids.has(id)) {const n = new Node('div'); n.id = id;} return ids.get(id);}, addEventListener() {}};
  const aside = new Node('aside'); aside.appendChild(document.getElementById('search-container')); aside.appendChild(document.getElementById('history-list'));
  document.getElementById('pinned-section').appendChild(document.getElementById('pinned-list'));
  const history = Object.fromEntries(['chat_a', 'chat_b', 'chat_c'].map((id, i) => [id, [{id: 'm' + i, role: 'user', title: ['Alpha', 'Beta', 'Gamma'][i], content: 'hello'}]]));
  const metadata = {chat_a: {pinned: true, tags: ['work', 'research'], model_binding: {profile_id: 'p', model_name: 'saved-model'}}, chat_b: {tags: ['work']}};
  let failSave = false;
  const api = {get_history: async () => clone(history), get_metadata: async () => clone(metadata),
    get_config: async () => ({active_profile_id: 'p', profiles: {p: {model_name: 'saved-model'}}}), list_models: async () => ({ok: false}), get_version: async () => '1.2.1',
    get_chat_tag_index: async () => {const chats = {}, counts = {}; for (const id of Object.keys(history)) {chats[id] = (metadata[id] || {}).tags || []; for (const name of chats[id]) counts[name] = (counts[name] || 0) + 1;}
      return {ok: true, chats: clone(chats), tags: Object.keys(counts).sort().map(name => ({name, count: counts[name]}))};},
    get_chat_tags: async id => ({ok: true, tags: clone((metadata[id] || {}).tags || [])}),
    set_chat_tags: async (id, tags) => {saves.push([id, clone(tags)]); if (failSave) return {ok: false, message: 'Disk save failed.'};
      metadata[id] = {...metadata[id], tags: [...new Set(tags.map(t => t.toLowerCase()))].sort()}; return {ok: true, tags: metadata[id].tags};}};
  const ctx = {document, console, localStorage: {getItem: () => null, setItem() {}}, setTimeout: () => 1, clearTimeout() {},
    marked: {Renderer: function () {}, setOptions() {}}, addEventListener: (k, f) => {(events[k] ||= []).push(f);}};
  ctx.window = ctx; if (!delayed) ctx.pywebview = {api};
  vm.createContext(ctx); vm.runInContext(app, ctx); ctx.showToast = t => notices.push(t);
  vm.runInContext("activeChatId = 'chat_c';", ctx); document.getElementById('chat-messages').innerHTML = 'KEEP CURRENT CHAT';
  vm.runInContext(source, ctx);
  async function redraw(term = '') {ctx.renderHistoryItems(history, metadata, term); await ctx.AsproChatTags.whenIdle();}
  function rows() {return ['history-list', 'pinned-list'].flatMap(id => document.getElementById(id).children).filter(r => r.querySelector('[data-title-for]'));}
  function row(id) {return rows().find(r => r.querySelector('[data-title-for]').getAttribute('data-title-for') === id);}
  async function edit(id) {let stopped = false; row(id).querySelector('[data-aspro-tag-button]').onclick({stopPropagation() {stopped = true;}}); assert.equal(stopped, true); await tick();}
  return {ctx, api, document, history, metadata, saves, redraw, row, rows, edit,
    filter(value) {const s = document.getElementById('aspro-tag-filter'); s.value = value; s.onchange();},
    visible() {return rows().filter(r => r.style.display !== 'none').map(r => r.querySelector('[data-title-for]').getAttribute('data-title-for')).sort();},
    failSave() {failSave = true;},
    async ready() {ctx.pywebview = {api}; await Promise.all((events.pywebviewready || []).map(f => f())); await redraw();}};
}
(async () => {
  let h = harness(); await h.redraw(); assert.deepEqual(h.visible(), ['chat_a', 'chat_b', 'chat_c']);
  h.filter('tag:work'); assert.deepEqual(h.visible(), ['chat_a', 'chat_b']);
  assert.equal(h.document.getElementById('chat-messages').innerHTML, 'KEEP CURRENT CHAT');
  assert.equal(h.document.getElementById('chat-messages').classList.contains('hidden'), false);
  assert.equal(vm.runInContext('activeChatId', h.ctx), 'chat_c');
  console.log('PASS filtering real sidebar renderer leaves the active conversation untouched');
  h.filter('untagged'); assert.deepEqual(h.visible(), ['chat_c']);
  assert.equal(h.document.getElementById('pinned-section').classList.contains('hidden'), true);
  h.filter(''); assert.equal(h.document.getElementById('pinned-section').classList.contains('hidden'), false);
  console.log('PASS untagged filtering and pinned section visibility');
  await h.redraw('beta'); h.filter('tag:work'); assert.deepEqual(h.visible(), ['chat_b']);
  console.log('PASS text search and tags intersect without dropping history');
  await h.redraw(); h.filter(''); await h.edit('chat_a');
  const before = clone(h.metadata.chat_a); h.document.getElementById('aspro-chat-tags').value = 'new, Work';
  await h.document.getElementById('aspro-tag-editor').children.find(n => n.tag === 'button').onclick();
  assert.deepEqual(h.saves[0], ['chat_a', ['new', 'Work']]); assert.equal(h.metadata.chat_a.pinned, true);
  assert.deepEqual(h.metadata.chat_a.model_binding, before.model_binding); assert.deepEqual(h.metadata.chat_b.tags, ['work']);
  console.log('PASS editing the intended chat preserves pins, models and other chats');
  h.document.getElementById('aspro-chat-tags').value = ''; await h.document.getElementById('aspro-tag-editor').children.find(n => n.tag === 'button').onclick();
  assert.deepEqual(h.metadata.chat_a.tags, []); assert.equal(Object.keys(h.history).length, 3);
  console.log('PASS removing tags does not delete conversations');
  h.failSave(); h.document.getElementById('aspro-chat-tags').value = 'not-saved';
  await h.document.getElementById('aspro-tag-editor').children.find(n => n.tag === 'button').onclick(); assert.deepEqual(h.metadata.chat_a.tags, []);
  assert.ok(h.document.getElementById('aspro-tag-editor').textContent.includes('Disk save failed.'));
  console.log('PASS failed saves remain visible and are not treated as success');
  h = harness(true); await h.redraw(); assert.deepEqual(h.visible(), ['chat_a', 'chat_b', 'chat_c']);
  await h.ready(); h.filter('tag:work'); assert.deepEqual(h.visible(), ['chat_a', 'chat_b']);
  console.log('PASS delayed bridge installs without hiding legacy chats');
  h.api.get_chat_tag_index = async () => {throw Error('offline');}; await h.redraw(); assert.deepEqual(h.visible(), ['chat_a', 'chat_b', 'chat_c']);
  console.log('PASS backend failure clears only sidebar filtering');
  h = harness(); h.metadata.chat_b.tags = ['<img onerror=bad>']; await h.redraw();
  const select = h.document.getElementById('aspro-tag-filter'); assert.ok(select.children.some(n => n.textContent.includes('<img onerror=bad>')));
  assert.ok(select.children.every(n => n.tag === 'option')); h.filter('tag:<img onerror=bad>'); assert.deepEqual(h.visible(), ['chat_b']);
  console.log('PASS tag names remain plain text');
  let release, reads = 0; const actual = h.api.get_chat_tag_index;
  h.api.get_chat_tag_index = () => ++reads === 1 ? new Promise(r => {release = () => r({ok: true, chats: {}, tags: [{name: 'STALE', count: 1}]});}) : actual();
  h.ctx.renderHistoryItems(h.history, h.metadata, ''); h.ctx.renderHistoryItems(h.history, h.metadata, '');
  await h.ctx.AsproChatTags.whenIdle(); release(); await tick();
  assert.ok(!h.document.getElementById('aspro-tag-filter').children.some(n => n.textContent.includes('STALE')));
  console.log('PASS stale index response cannot overwrite newer tags');
})().catch(e => {console.error(e); process.exitCode = 1;});
