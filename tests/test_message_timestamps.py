"""Use the real node creator, with a stub clock; no GUI, provider calls or user files."""
import ast
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
source = ast.parse((ROOT / 'backend/history.py').read_text(encoding='utf-8'))
history_class = next(n for n in source.body if isinstance(n, ast.ClassDef) and n.name == 'HistoryMixin')
namespace = {'os': os}
exec(compile(ast.Module(body=[history_class], type_ignores=[]), 'history.py', 'exec'), namespace)
History = namespace['HistoryMixin']
tree = ast.parse((ROOT / 'backend/message_timestamps.py').read_text(encoding='utf-8'))
tree.body = [n for n in tree.body if not isinstance(n, ast.ImportFrom) or n.module != 'history']
ns = {'HistoryMixin': History}
exec(compile(tree, 'message_timestamps.py', 'exec'), ns)


class Harness(ns['MessageTimestampsMixin'], History):
    def __init__(self): self.history = {'c': {'nodes': {}, 'current_node': None}}


class TimestampTests(unittest.TestCase):
    def setUp(self): self.e = Harness()
    def add(self, role='user', **kwargs): return self.e._add_node('c', role, 'text', 'label', 'title', False, **kwargs)

    def test_utc_creation_time(self):
        fixed = datetime(2026, 10, 29, 22, 0, 1, tzinfo=timezone.utc)
        clock = Mock(); clock.now.return_value = fixed
        with patch.dict(ns, datetime=clock): nid = self.add()
        self.assertEqual(self.e.history['c']['nodes'][nid]['created_at'], '2026-10-29T22:00:01+00:00')
        clock.now.assert_called_once_with(timezone.utc)

    def test_all_message_roles(self):
        for role in ('user', 'assistant', 'system'):
            nid = self.add(role)
            self.assertEqual(datetime.fromisoformat(self.e.history['c']['nodes'][nid]['created_at']).utcoffset().total_seconds(), 0)

    def test_existing_history_not_backfilled(self):
        old = History._add_node(self.e, 'c', 'user', 'old', 'old', '', False)
        self.add('assistant')
        self.assertNotIn('created_at', self.e.history['c']['nodes'][old])

    def test_original_fields_and_tree_links_are_preserved(self):
        files = [{'name': 'a.pdf', 'path': 'example'}]
        first = self.add(files=files, image='data:image/png;base64,aA==')
        second = self.add('assistant')
        nodes = self.e.history['c']['nodes']
        self.assertEqual(nodes[first]['files'], files)
        self.assertEqual(nodes[first]['image'], 'data:image/png;base64,aA==')
        self.assertEqual(nodes[first]['children'], [second]); self.assertEqual(nodes[second]['parent'], first)
        self.assertEqual(nodes[first]['content'], 'text'); self.assertEqual(nodes[first]['display_text'], 'label')
        self.assertEqual(self.e.history['c']['current_node'], second)

    def test_timestamp_does_not_change_when_stream_content_changes(self):
        nid = self.add('assistant'); n = self.e.history['c']['nodes'][nid]; before = n['created_at']
        n['content'] = 'Finished answer'; self.assertEqual(n['created_at'], before)

    def test_clock_failure_does_not_block_message_or_invent_time(self):
        clock = Mock(); clock.now.side_effect = OSError('clock failure')
        with patch.dict(ns, datetime=clock): nid = self.add()
        self.assertIn(nid, self.e.history['c']['nodes']); self.assertNotIn('created_at', self.e.history['c']['nodes'][nid])

    def test_fields_survive_json_round_trip(self):
        self.add(); self.assertEqual(json.loads(json.dumps(self.e.history)), self.e.history)

    def test_original_failure_does_not_create_message(self):
        before = deepcopy(self.e.history)
        with self.assertRaises(KeyError): self.e._add_node('missing', 'user', '', '', '', False)
        self.assertEqual(self.e.history, before)

    def test_engine_route_and_unique_definition(self):
        t = ast.parse((ROOT / 'backend/engine.py').read_text())
        cls = next(n for n in t.body if isinstance(n, ast.ClassDef) and n.name == 'ChatEngine')
        route = next(n for n in cls.body if isinstance(n, ast.Assign) and any(isinstance(x, ast.Name) and x.id == '_add_node' for x in n.targets))
        self.assertEqual(ast.unparse(route.value), 'MessageTimestampsMixin._timestamp_add_node')
        self.assertIn('MessageTimestampsMixin', [ast.unparse(b) for b in cls.bases])
        own = ast.parse((ROOT / 'backend/message_timestamps.py').read_text())
        names = [n.name for c in own.body if isinstance(c, ast.ClassDef) for n in c.body if isinstance(n, ast.FunctionDef)]
        self.assertEqual(names, ['_timestamp_add_node'])


if __name__ == '__main__': unittest.main()
