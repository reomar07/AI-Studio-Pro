"""Tags exercise the real storage class in a disposable folder; no GUI or provider calls."""
import ast
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from backend.chat_tags import ChatTagsMixin

ROOT = Path(__file__).resolve().parents[1]
TREE = ast.parse((ROOT / 'backend/storage.py').read_text(encoding='utf-8'))
STORAGE_CLASS = next(n for n in TREE.body if isinstance(n, ast.ClassDef))
NS = dict(os=os, json=json, shutil=shutil, time=time)
exec(compile(ast.Module(body=[STORAGE_CLASS], type_ignores=[]), 'storage.py', 'exec'), NS)


class Harness(ChatTagsMixin, NS['StorageMixin']):
    def __init__(self, path):
        self._chat_tags_metadata_file = str(path)
        self.file_lock = threading.Lock()
        self.history = {'chat_a': {}, 'chat_b': {}}
        self.current_chat_id = 'chat_new'
        self.metadata = self._load_json(str(path), {})
        self.config = {'api_key': 'PRIVATE-PROVIDER-KEY'}


class ChatTagTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'metadata.json'
        self.e = Harness(self.path)

    def save(self, cid='chat_a', tags=None):
        result = self.e.set_chat_tags(cid, tags if tags is not None else ['work'])
        self.assertTrue(result['ok'], result)
        return result

    def test_legacy_reads_do_not_create_files(self):
        self.assertEqual(self.e.get_chat_tags('chat_a')['tags'], [])
        self.assertEqual(self.e.get_chat_tag_index()['tags'], [])
        self.assertFalse(self.path.exists())

    def test_unicode_normalization_and_casefold(self):
        self.save(tags=['  WORK  ', 'Cafe\u0301', 'CAFÉ', 'مرحبا', 'two   words'])
        self.assertEqual(self.e.get_chat_tags('chat_a')['tags'], ['café', 'two words', 'work', 'مرحبا'])

    def test_duplicates_are_one_tag(self):
        self.save(tags=['Straße', 'STRASSE', 'Work', 'work'])
        self.assertEqual(self.e.get_chat_tags('chat_a')['tags'], ['strasse', 'work'])

    def test_boundaries(self):
        self.save(tags=['x' * 32] + ['t' + str(n) for n in range(7)])
        self.assertFalse(self.e.set_chat_tags('chat_a', ['x' * 33])['ok'])
        self.assertFalse(self.e.set_chat_tags('chat_a', ['ß' * 32])['ok'])
        self.assertFalse(self.e.set_chat_tags('chat_a', ['t' + str(n) for n in range(9)])['ok'])

    def test_invalid_inputs_never_write(self):
        for value in (None, True, 'work', {}, [None], [1], [''], ['  '], ['a,b'], ['a\nb'], ['a\x00b']):
            self.assertFalse(self.e.set_chat_tags('chat_a', value)['ok'], repr(value))
        self.assertFalse(self.path.exists())

    def test_unknown_chat(self):
        for cid in ('missing', '', None, [], 'x' * 129):
            self.assertFalse(self.e.set_chat_tags(cid, ['work'])['ok'])
            self.assertFalse(self.e.get_chat_tags(cid)['ok'])
        self.assertFalse(self.path.exists())

    def test_current_unsent_chat(self):
        self.save('chat_new'); self.assertEqual(self.e.get_chat_tags('chat_new')['tags'], ['work'])

    def test_index_counts_each_chat_once(self):
        self.save('chat_a', ['work', 'shared']); self.save('chat_b', ['shared'])
        r = self.e.get_chat_tag_index()
        self.assertEqual(r['tags'], [{'name': 'shared', 'count': 2}, {'name': 'work', 'count': 1}])
        self.assertEqual(r['chats'], {'chat_a': ['shared', 'work'], 'chat_b': ['shared']})

    def test_untagged_and_orphan_metadata(self):
        self.e.metadata = {'orphan': {'tags': ['ignore']}}
        r = self.e.get_chat_tag_index()
        self.assertEqual(r['tags'], []); self.assertEqual(r['chats']['chat_b'], [])
        self.assertNotIn('orphan', r['chats'])

    def test_preserves_pins_models_and_other_chat(self):
        self.e.metadata = {'chat_a': {'pinned': True, 'model_binding': {'profile_id': 'p', 'model_name': 'm', 'image_model': ''}, 'custom': 4},
                           'chat_b': {'pinned': False, 'tags': ['old']}}
        before = deepcopy(self.e.metadata)
        self.save(tags=['research'])
        stored = json.loads(self.path.read_text())
        self.assertEqual({k: v for k, v in stored['chat_a'].items() if k != 'tags'}, before['chat_a'])
        self.assertEqual(stored['chat_b'], before['chat_b'])
        self.assertNotIn('PRIVATE-PROVIDER-KEY', self.path.read_text())

    def test_clear_does_not_delete_chats(self):
        self.save(); before = deepcopy(self.e.history)
        self.save(tags=[]); self.assertEqual(self.e.get_chat_tags('chat_a')['tags'], [])
        self.assertEqual(self.e.history, before); self.assertEqual(self.e.get_chat_tag_index()['tags'], [])

    def test_survives_reload(self):
        self.save(tags=['alpha', 'beta'])
        other = Harness(self.path)
        self.assertEqual(other.get_chat_tags('chat_a')['tags'], ['alpha', 'beta'])

    def test_imported_invalid_tags_are_ignored_without_rewriting(self):
        self.e.metadata = {'chat_a': {'tags': ['Work', 7, 'x\n', 'two   words'], 'pinned': True}, 'chat_b': {'tags': 'broken'}}
        before = deepcopy(self.e.metadata)
        self.assertEqual(self.e.get_chat_tags('chat_a')['tags'], ['two words', 'work'])
        self.assertEqual(self.e.get_chat_tags('chat_b')['tags'], [])
        self.assertEqual(self.e.metadata, before); self.assertFalse(self.path.exists())

    def test_damaged_metadata_is_not_replaced(self):
        self.e.metadata = {'chat_a': None}
        self.assertFalse(self.e.set_chat_tags('chat_a', ['work'])['ok'])
        self.assertFalse(self.e.get_chat_tags('chat_a')['ok'])
        self.assertIsNone(self.e.metadata['chat_a'])
        self.e.metadata = []
        self.assertFalse(self.e.get_chat_tag_index()['ok'])
        self.assertFalse(self.e.set_chat_tags('chat_a', ['work'])['ok'])

    def test_silent_real_storage_failure_is_detected(self):
        self.save(tags=['before'])
        with patch.object(os, 'replace', side_effect=OSError('simulated read-only disk')):
            result = self.e.set_chat_tags('chat_a', ['after'])
        self.assertFalse(result['ok'])
        self.assertEqual(self.e.get_chat_tags('chat_a')['tags'], ['before'])
        self.assertEqual(json.loads(self.path.read_text())['chat_a']['tags'], ['before'])
        self.assertEqual(list(self.path.parent.glob('*.tmp_*')), [])

    def test_rollback_only_tags_preserves_concurrent_other_fields(self):
        self.save(tags=['before'])
        def interrupted(*args):
            self.e.metadata['chat_a']['pinned'] = True
            self.e.metadata['chat_b'] = {'custom': 'keep'}
        with patch.object(self.e, '_save_json', side_effect=interrupted):
            self.assertFalse(self.e.set_chat_tags('chat_a', ['after'])['ok'])
        self.assertEqual(self.e.metadata['chat_a'], {'tags': ['before'], 'pinned': True})
        self.assertEqual(self.e.metadata['chat_b'], {'custom': 'keep'})

    def test_first_failed_save_does_not_leave_empty_metadata(self):
        with patch.object(self.e, '_save_json', side_effect=OSError('no write')):
            self.assertFalse(self.e.set_chat_tags('chat_a', ['work'])['ok'])
        self.assertNotIn('chat_a', self.e.metadata)

    def test_readback_failure_never_claims_verified_save(self):
        with patch.object(self.e, '_load_json', side_effect=OSError('cannot verify')):
            result = self.e.set_chat_tags('chat_a', ['work'])
        self.assertFalse(result['ok']); self.assertIn('verified', result['message'])

    def test_returned_tags_are_independent(self):
        r = self.save(); r['tags'].append('outside')
        r = self.e.get_chat_tags('chat_a'); r['tags'].clear()
        self.assertEqual(self.e.get_chat_tags('chat_a')['tags'], ['work'])

    def test_parallel_tag_requests_serialize(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda n: self.e.set_chat_tags('chat_a', ['t' + str(n)]), range(12)))
        self.assertTrue(all(r['ok'] for r in results))
        self.assertEqual(json.loads(self.path.read_text())['chat_a']['tags'], self.e.get_chat_tags('chat_a')['tags'])

    def test_html_is_plain_label_data(self):
        self.save(tags=['<img onerror=bad>'])
        self.assertEqual(self.e.get_chat_tags('chat_a')['tags'], ['<img onerror=bad>'])

    def test_engine_wiring_uses_existing_metadata_file(self):
        tree = ast.parse((ROOT / 'backend/engine.py').read_text())
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'ChatEngine')
        self.assertIn('ChatTagsMixin', [ast.unparse(n) for n in cls.bases])
        assignment = next(n for n in cls.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == '_chat_tags_metadata_file' for t in n.targets))
        self.assertEqual(ast.unparse(assignment.value), 'METADATA_FILE')


if __name__ == '__main__': unittest.main()
