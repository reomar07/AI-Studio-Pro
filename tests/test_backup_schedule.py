"""Backup tests use disposable folders and a source-loaded backend, never real user data."""
import ast
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        tree = ast.parse((ROOT / 'backend/backup_schedule.py').read_text(encoding='utf-8'))
        tree.body = [n for n in tree.body if not isinstance(n, ast.ImportFrom) or n.module != 'shared']
        self.b = {'DATA_DIR': self.tmp.name}
        exec(compile(tree, 'backup_schedule.py', 'exec'), self.b)
        cls = type('Engine', (self.b['BackupScheduleMixin'],), {})
        self.e = cls(); self.e.history = {'chat_a': {'nodes': {'u': {'role': 'user', 'content': 'hello'}}}}
        self.e.metadata = {'chat_a': {'pinned': True}}; self.e.chat_settings = {'chat_a': {'temperature': 0.7}}
        self.e.config = {'api_key': 'SECRET-KEY'}
        self.clock = patch.object(self.b['time'], 'time', return_value=1700000000); self.clock.start(); self.addCleanup(self.clock.stop)
        self.folder = Path(self.b['BACKUP_DIR'])

    def files(self): return self.b['_files']()
    def enable(self, keep=2): self.assertTrue(self.e.set_backup_settings(True, 6, keep)['ok'])
    def changed(self): self.e.history['chat_a']['nodes']['u']['content'] += '!'
    def backup(self):
        r = self.e.run_backup_now(); self.assertTrue(r['ok'], r); return r

    def test_defaults(self):
        r = self.e.get_backup_settings(); self.assertFalse(r['enabled']); self.assertEqual(r['keep'], 7)
        self.assertEqual(self.e.run_backup_if_due()['reason'], 'not_due')

    def test_validation(self):
        for args in [('yes', 24, 7), (True, True, 7), (True, 5, 7), (True, 6, 0), (False, 24, 31)]:
            self.assertFalse(self.e.set_backup_settings(*args)['ok'])

    def test_settings_persist(self):
        self.enable(3); self.assertEqual((self.e.get_backup_settings()['interval_hours'], self.e.get_backup_settings()['keep']), (6, 3))

    def test_manual_works_when_off(self):
        self.assertTrue(self.backup()['ran']); self.assertFalse(self.e.get_backup_settings()['enabled'])

    def test_interval(self):
        self.enable(); self.backup(); self.changed()
        self.assertEqual(self.e.run_backup_if_due()['reason'], 'not_due')
        with patch.object(self.b['time'], 'time', return_value=1700000000 + 7 * 3600): self.assertTrue(self.e.run_backup_if_due()['ran'])

    def test_dedup(self):
        self.backup(); self.assertEqual(self.backup()['reason'], 'unchanged'); self.assertEqual(len(self.files()), 1)

    def test_empty_keeps_old(self):
        self.backup(); self.e.history = {}; self.assertEqual(self.backup()['reason'], 'empty'); self.assertEqual(len(self.files()), 1)

    def test_retention_and_unrelated_files(self):
        self.enable(2); self.folder.mkdir(parents=True)
        (self.folder / 'notes.json').write_text('keep')
        for _ in range(5): self.changed(); self.backup()
        self.assertEqual(len(self.files()), 2); self.assertEqual((self.folder / 'notes.json').read_text(), 'keep')

    def test_clock_backwards_protects_new_and_keeps_exact_limit(self):
        self.enable(1); old = self.backup()['name']; os.utime(self.folder / old, (1900000000, 1900000000)); self.changed()
        with patch.object(self.b['time'], 'time', return_value=1600000000): r = self.e.run_backup_if_due()
        self.assertTrue(r['ran']); self.assertEqual([x['name'] for x in self.files()], [r['name']])

    def test_failed_write_never_prunes(self):
        self.enable(1); self.backup(); before = self.files(); self.changed()
        with patch.dict(self.b, {'_write': lambda *args: False}): self.assertFalse(self.e.run_backup_now()['ok'])
        self.assertEqual(self.files(), before)

    def test_full_readback_mismatch_never_prunes(self):
        self.enable(1); self.backup(); before = self.files(); self.changed(); original = json.load
        def read(f, *a, **k):
            if Path(f.name).parent == self.folder: return {'wrong': 'same chat count is not enough'}
            return original(f, *a, **k)
        with patch.object(self.b['json'], 'load', side_effect=read): self.assertFalse(self.e.run_backup_now()['ok'])
        self.assertEqual(self.files(), before)

    def test_corrupt_settings_are_off_not_overwritten_by_read(self):
        p = Path(self.b['SETTINGS_FILE']); p.write_text('{bad')
        self.assertIn('could not be read', self.e.get_backup_settings()['warning']); self.assertFalse(self.e.get_backup_settings()['enabled'])
        self.assertEqual(p.read_text(), '{bad')

    def test_symlinks_ignored(self):
        self.folder.mkdir(); outside = Path(self.tmp.name) / 'outside'; outside.write_text('keep')
        try: (self.folder / 'backup_20260101_000000.json').symlink_to(outside)
        except OSError: self.skipTest('No symlink support')
        self.assertEqual(self.files(), []); self.backup(); self.assertEqual(outside.read_text(), 'keep')

    def test_lookalike_directory_ignored(self):
        (self.folder / 'backup_20260101_000000.json').mkdir(parents=True); self.assertEqual(self.files(), [])

    def test_format_and_no_credentials(self):
        r = self.backup(); raw = (self.folder / r['name']).read_text(); data = json.loads(raw)
        self.assertEqual(set(data), {'app', 'version', 'history', 'metadata', 'settings'})
        self.assertEqual(data['history'], self.e.history); self.assertNotIn('SECRET-KEY', raw)
        self.assertIn('Attachments', self.e.get_backup_settings()['note'])

    def test_collision(self):
        a = self.backup()['name']; self.changed(); b = self.backup()['name']; self.assertNotEqual(a, b)

    def test_active_generation_is_deferred(self):
        self.e._chat_model_worker_running = True; self.assertEqual(self.backup()['reason'], 'busy'); self.assertEqual(self.files(), [])

    def test_settings_write_failure_preserves_previous(self):
        self.enable(2)
        with patch.dict(self.b, {'_write': lambda *a: False}): self.assertFalse(self.e.set_backup_settings(False, 24, 8)['ok'])
        self.assertTrue(self.e.get_backup_settings()['enabled']); self.assertEqual(self.e.get_backup_settings()['keep'], 2)

    def test_serialization_failure_never_prunes(self):
        self.backup(); before = self.files(); self.e.history = {'bad': object()}
        self.assertFalse(self.e.run_backup_now()['ok']); self.assertEqual(self.files(), before)

    def test_invalid_chat_does_not_replace_good_backups(self):
        self.backup(); before = self.files(); self.changed(); self.e._valid_chat = lambda value: False
        self.assertFalse(self.e.run_backup_now()['ok']); self.assertEqual(self.files(), before)

    def test_engine_wiring(self):
        tree = ast.parse((ROOT / 'backend/engine.py').read_text(encoding='utf-8'))
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'ChatEngine')
        self.assertIn('BackupScheduleMixin', [ast.unparse(b) for b in cls.bases])

    def test_listing_is_bounded(self):
        self.folder.mkdir()
        for n in range(45): (self.folder / ('backup_20260101_000000_' + str(n) + '.json')).write_text('{}')
        r = self.e.get_backup_settings(); self.assertEqual(r['backup_count'], 45); self.assertEqual(len(r['backups']), 40)


if __name__ == '__main__': unittest.main()
