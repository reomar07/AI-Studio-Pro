"""Static release-script regressions; these do not build or execute a Windows application."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ReleasePackagingTests(unittest.TestCase):
    def test_explicit_optional_voice_build(self):
        source = (ROOT / 'build_exe.bat').read_text()
        self.assertIn('VOICE_FLAGS=--exclude-module piper', source)
        self.assertIn('requirements-voices.txt', source)
        self.assertIn('--collect-all piper --collect-all onnxruntime', source)
        self.assertIn('BUILD_DEPENDENCIES.txt', source)
        self.assertIn('BUILD_MODE.txt', source)
        self.assertIn('if not defined CI pause', source)
        self.assertIn('xcopy /E /I /Y frontend', source)

    def test_installer_validates_packaged_vendor_files(self):
        source = (ROOT / 'build_installer.bat').read_text()
        self.assertIn('"dist\\AI Studio Pro\\vendor\\marked.min.js"', source)
        self.assertIn('if %%~zF LSS 3000 goto :novendor', source)
        self.assertIn('if not exist "%%~fF" goto :novendor', source)
        self.assertIn('BUILD_MODE.txt', source)

    def test_readme_discloses_validation_limitations(self):
        source = (ROOT / 'README.md').read_text()
        for phrase in ('Local storage does not mean every request stays offline', 'requirements-voices.txt', 'not in a security sandbox', 'not a single-file build', 'No Windows build'):
            self.assertIn(phrase, source)
