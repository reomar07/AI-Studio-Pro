'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const workspace = require('../frontend/scripts/workspace_index.js');
const pages = require('../frontend/scripts/web_pages.js');
const voices = require('../frontend/scripts/offline_voices.js');
async function main() {
  assert.equal(workspace.describe({attached: false}), 'No folder index');
  assert.equal(workspace.describe({attached: true, indexing: true}), 'Scanning…');
  assert.equal(workspace.describe({attached: true, chunks: 2, files: 1}), '2 passages from 1 file');
  assert.equal(pages.normalize({mode: 'choose'}).mode, 'choose');
  assert.equal(pages.normalize({mode: 'invalid'}).mode, 'results');
  assert.match(pages.noticeLines({profile: 'Cloud', host: 'example.org', is_local: false}, 2).join(' '), /6,000 characters/);
  let sent = 0;
  const log = [];
  const deps = {mode: 'choose', webActive: true, generating: false, imageMode: false, text: 'question', ask: async () => ['https://example.org'], notify: m => log.push(m), api: {web_clear_selected_pages: async () => log.push('clear'), web_select_pages: async urls => ({ok: true, accepted: urls})}};
  await pages.runGate(deps, () => ++sent); assert.equal(sent, 1); assert.equal(log[0], 'clear');
  deps.ask = async () => null;
  await pages.runGate(deps, () => ++sent); assert.equal(sent, 1);
  assert.equal(voices.guessLanguage('Bonjour à vous'), 'fr');
  assert.equal(voices.guessLanguage('مرحبا بكم'), 'ar');
  assert.equal(voices.chooseOfflineVoice({voices: {en: 'v'}}, {engine: false, voices: []}, 'en'), '');
  assert.equal(voices.chooseOfflineVoice({voices: {en: 'v'}}, {engine: true, voices: [{id: 'v', lang: 'en', installed: true}]}, 'en'), 'v');
  const loaded = [], nodes = new Map();
  const context = {console, location: {href: 'test'}, alert: () => {}};
  const flags = {'workspace_index.js': '__asproWorkspaceIndexVersion', 'offline_voices.js': '__asproOfflineVoicesVersion', 'context_menu.js': '__asproContextMenuVersion', 'speech.js': '__asproVoiceReady', 'model_favorites.js': '__asproModelFavoritesVersion', 'usage_summary.js': '__asproUsageSummaryVersion', 'backup_schedule.js': '__asproBackupScheduleVersion', 'chat_tags.js': '__asproChatTagsVersion', 'message_display.js': '__asproMessageDisplayVersion', 'web_pages.js': '__asproWebPagesVersion'};
  function append(n) {
    if (n.id) nodes.set(n.id, n);
    if (n.src) {
      const file = n.src.split('/').pop().split('?')[0]; loaded.push(file);
      assert.ok(fs.existsSync(path.join(root, 'frontend/scripts', file)));
      if (file === 'appearance.js') { nodes.set('aspro-preferences', {}); context.document.documentElement.dataset.asproTheme = 'graphite'; }
      else if (file === 'spelling.js') context.AsproSpelling = {version: 2};
      else context[flags[file]] = file === 'context_menu.js' ? 2 : 1;
    }
    if (n.href) assert.ok(fs.existsSync(path.join(root, n.href.split('?')[0])));
    if (n.onload) queueMicrotask(n.onload);
  }
  context.document = {readyState: 'complete', documentElement: {dataset: {}}, getElementById: id => nodes.get(id), createElement: () => ({style: {}, dataset: {}}), body: {appendChild: append}, head: {appendChild: append}};
  context.window = context; context.addEventListener = () => {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'frontend/scripts/bootstrap.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.__asproFeaturesReady, true);
  assert.ok(loaded.indexOf('offline_voices.js') < loaded.indexOf('speech.js'));
  assert.ok(loaded.includes('web_pages.js')); assert.ok(loaded.includes('workspace_index.js'));
  console.log('PASS helper checks, send/cancel gate, and startup loader smoke test (module initialization simulated; not Windows playback).');
}
main().catch(e => {console.error(e); process.exitCode = 1;});
