"""Privacy disclosure regressions without network or provider calls."""
import ast
from pathlib import Path
import shutil
import subprocess
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]


def privacy_namespace():
    tree = ast.parse((ROOT / 'backend/web_privacy.py').read_text(encoding='utf-8'))
    tree.body = [n for n in tree.body if not isinstance(n, ast.ImportFrom)]
    ns = {'WebPagesMixin': SimpleNamespace(web_provider_notice=lambda self, chat_id=None: dict(self.notice))}
    exec(compile(tree, 'web_privacy.py', 'exec'), ns)
    return ns


class WebPrivacyTests(unittest.TestCase):
    def test_hostname_classification(self):
        ns = privacy_namespace()
        for host in ('localhost', 'LOCALHOST.', '127.0.0.1', '127.0.0.2', '::1'):
            self.assertTrue(ns['provider_host_is_loopback'](host), host)
        for host in ('localhost.example.org', '127.0.0.1.example.org', 'example.org', '192.168.1.2', '0.0.0.0', ''):
            self.assertFalse(ns['provider_host_is_loopback'](host), host)

    def test_legacy_notice_is_corrected(self):
        ns = privacy_namespace()
        engine = ns['WebPrivacyMixin']()
        engine.notice = {'host': 'localhost.example.org', 'is_local': True}
        self.assertFalse(engine._privacy_provider_notice()['is_local'])
        engine.notice = {'host': '::1', 'is_local': False}
        self.assertTrue(engine._privacy_provider_notice()['is_local'])
        source = (ROOT / 'backend/engine.py').read_text(encoding='utf-8')
        self.assertIn('web_provider_notice = WebPrivacyMixin._privacy_provider_notice', source)

    @unittest.skipUnless(shutil.which('node'), 'Node is required for frontend disclosure checks')
    def test_disclosure_and_cancel_gate(self):
        script = """
const a=require('node:assert/strict');const p=require('./frontend/scripts/web_pages.js');
const n=p.noticeLines({profile:'Test',host:'localhost',is_local:true},2).join(' ');
for(const t of ['earlier conversation','attached document','workspace','forwards requests','Cancel cannot retract','6,000 characters'])a.ok(n.includes(t),t);
let sent=0;const d={mode:'choose',webActive:true,text:'q',ask:async()=>null,api:{},notify:()=>{}};
(async()=>{await p.runGate(d,()=>sent++);a.equal(sent,0);d.ask=async()=>['a','b'];d.api={web_clear_selected_pages:async()=>true,web_select_pages:async()=>({ok:true,accepted:['a']})};await p.runGate(d,()=>sent++);a.equal(sent,0);})().catch(e=>{console.error(e);process.exitCode=1;});
"""
        result = subprocess.run(['node', '-e', script], cwd=ROOT, text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
