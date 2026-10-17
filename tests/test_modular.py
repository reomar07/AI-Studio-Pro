"""Run with: python -m unittest discover -s tests -v. No AI/network calls."""
import ast
import hashlib
import inspect
import json
import os
from pathlib import Path
import re
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class ModularTests(unittest.TestCase):
    def test_methods_unchanged(self):
        report = json.loads((ROOT / "REFACTOR_REPORT.json").read_text(encoding="utf-8"))
        actual = {}
        for file in (ROOT / "backend").glob("*.py"):
            if file.name in ("shared.py", "document_export.py"): continue
            tree = ast.parse(file.read_text(encoding="utf-8"))
            for cls in tree.body:
                if isinstance(cls, ast.ClassDef):
                    for node in cls.body:
                        if isinstance(node, ast.FunctionDef):
                            self.assertNotIn(node.name, actual)
                            actual[node.name] = hashlib.sha256(ast.dump(node, include_attributes=False).encode()).hexdigest()
        self.assertEqual(actual, report["method_ast_sha256"])

    def test_local_frontend_files_exist(self):
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        for path in re.findall(r'(?:src|href)="(frontend/[^"]+)"', page):
            self.assertTrue((ROOT / path).is_file(), path)
        self.assertNotRegex(page, r'<style>')
        self.assertNotRegex(page, r'<script\s*>')
        build = (ROOT / "build_exe.bat").read_text(encoding="utf-8")
        self.assertIn('xcopy /E /I /Y frontend', build)

    def test_engine_and_api_smoke(self):
        # Use a disposable home directory, never your actual chats or credentials.
        with tempfile.TemporaryDirectory() as home:
            old_home = os.environ.get("HOME")
            old_user = os.environ.get("USERPROFILE")
            os.environ["HOME"] = os.environ["USERPROFILE"] = home
            try:
                from backend import shared
                shared.keyring = None  # never access the real Windows credential vault in tests
                from backend.engine import ChatEngine
                from backend import profiles
                profiles.keyring = None
                self.assertEqual(Path(shared.BASE_DIR), ROOT)
                engine = ChatEngine()
                self.assertEqual(engine.get_history(), {})
                self.assertIsInstance(engine.get_config(), dict)
                self.assertIsInstance(engine.start_new_chat(), str)
                scripts = "\n".join(p.read_text(encoding="utf-8") for p in (ROOT / "frontend/scripts").glob("*.js"))
                for method in set(re.findall(r'pywebview\.api\.(\w+)', scripts)):
                    self.assertTrue(callable(getattr(engine, method, None)), method)
                self.assertGreater(len(inspect.getmembers(engine, inspect.ismethod)), 20)
            finally:
                if old_home is None: os.environ.pop("HOME", None)
                else: os.environ["HOME"] = old_home
                if old_user is None: os.environ.pop("USERPROFILE", None)
                else: os.environ["USERPROFILE"] = old_user

if __name__ == "__main__":
    unittest.main()
