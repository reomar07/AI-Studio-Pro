"""One-time, behavior-preserving split of the 1.2.1 application. Standard library only."""
import ast
import hashlib
import json
from pathlib import Path
import re
import sys

BASELINE = {
    "app-2.py": "71a4b0cc17a4053f48d9cd14e2462d361a332f8e",
    "index.html": "c68629dc9d073609422178e9915ffa2a90adeca0",
    "build_exe.bat": "be7aca3d2fb36af662042bbbd987f0d29716834b",
}
GROUPS = {
    "storage": {"_load_json", "_save_json"},
    "profiles": {"_keyring_ok", "_load_and_migrate_config", "_write_config", "key_storage_info", "get_config", "save_config", "list_models"},
    "history": {"_migrate_history_to_trees", "_get_linear_branch", "_add_node", "switch_branch", "_public", "get_history", "_valid_chat", "get_metadata", "get_chat_settings", "get_prompts", "save_prompt", "delete_prompt", "start_new_chat", "set_current_chat", "toggle_pin_chat", "delete_chat", "clear_all_chats", "rewind_chat", "rename_chat", "export_all_chats", "import_chats"},
    "documents": {"save_code_to_file", "export_chat_dialog", "_dialog_paths", "_get_python_interpreter", "execute_local_code", "_process_frontend_file", "_image_bytes", "_auto_store_image", "save_message_image", "_safe_filename", "_save_attachment", "_remove_attachment_folder", "open_attachment", "export_message"},
    "search": {"_tokenize", "attach_workspace", "_index_folder"},
}
IMPORTS = "from .shared import *\nfrom .shared import _ID_RE, _STATUS_PREFIX_RE\n"

def blob_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def method_source(lines, node):
    start = min([node.lineno] + [d.lineno for d in node.decorator_list]) - 1
    return "".join(lines[start:node.end_lineno]) + "\n"

def method_map(source, class_name=None):
    tree = ast.parse(source)
    return {n.name: ast.dump(n, include_attributes=False)
            for c in tree.body if isinstance(c, ast.ClassDef) and (class_name is None or c.name == class_name)
            for n in c.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}

def migrate(root, require_baseline=True):
    root = Path(root)
    if (root / "backend/engine.py").exists():
        raise RuntimeError("Already modularized; do not run the migration twice.")
    originals = {p: (root / p).read_bytes() for p in BASELINE}
    if require_baseline:
        for p, expected in BASELINE.items():
            if blob_sha(originals[p]) != expected:
                raise RuntimeError("Baseline mismatch in " + p + ". Stop rather than overwrite newer changes.")
    src = originals["app-2.py"].decode("utf-8").replace("\r\n", "\n")
    page = originals["index.html"].decode("utf-8").replace("\r\n", "\n")
    build = originals["build_exe.bat"].decode("utf-8").replace("\r\n", "\n")
    lines = src.splitlines(keepends=True)
    tree = ast.parse(src)
    engine = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "ChatEngine")
    main = next(n for n in tree.body if isinstance(n, ast.If) and ast.get_source_segment(src, n.test) == "__name__ == '__main__'")
    marker = "# ---------- document export helpers (Word / HTML) ----------"
    prefix = "".join(lines[:engine.lineno-1])
    common, exports = prefix.split(marker, 1)
    old_base = "os.path.dirname(os.path.abspath(__file__))"
    if common.count(old_base) != 1:
        raise RuntimeError("Unexpected BASE_DIR expression")
    common = common.replace(old_base, "os.path.dirname(os.path.dirname(os.path.abspath(__file__)))")
    common += "\nfrom .document_export import _ID_RE, _STATUS_PREFIX_RE, html_to_docx_bytes, build_html_document\n"
    exports = "import re\nimport io\nimport html as html_lib\ntry:\n    import docx\nexcept ImportError:\n    docx = None\n\n" + marker + exports
    generated = {"backend/__init__.py": '"""AI Studio Pro backend modules."""\n',
                 "backend/shared.py": common, "backend/document_export.py": exports}
    grouped = {k: [] for k in list(GROUPS) + ["generation"]}
    init = None
    for node in engine.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            raise RuntimeError("Unexpected class-level statement; manual review required")
        if node.name == "__init__":
            init = method_source(lines, node)
            continue
        group = next((g for g, names in GROUPS.items() if node.name in names), "generation")
        grouped[group].append(method_source(lines, node))
    mixins = []
    for group, methods in grouped.items():
        cls = group.title() + "Mixin"
        mixins.append((group, cls))
        generated["backend/" + group + ".py"] = IMPORTS + "\nclass " + cls + ":\n" + "\n".join(methods)
    generated["backend/engine.py"] = IMPORTS + "".join("from ." + g + " import " + c + "\n" for g, c in mixins)
    generated["backend/engine.py"] += "\nclass ChatEngine(" + ", ".join(c for _, c in mixins) + "):\n" + init
    generated["app-2.py"] = '"""Start AI Studio Pro. Feature implementations live in backend/."""\nfrom backend.shared import *\nfrom backend.engine import ChatEngine\n\n' + "".join(lines[main.lineno-1:main.end_lineno]) + "\n"
    style_blocks, js_blocks = [], []
    def style(match):
        path = "frontend/styles/base" + ("" if not style_blocks else str(len(style_blocks)+1)) + ".css"
        style_blocks.append(match.group(1))
        generated[path] = match.group(1)
        return '<link rel="stylesheet" href="' + path + '">'
    def script(match):
        attrs, code = match.group(1), match.group(2)
        if re.search(r"\bsrc\s*=", attrs, re.I):
            return match.group(0)
        path = "frontend/scripts/" + ("bootstrap.js" if not js_blocks else "app.js")
        if path in generated:
            raise RuntimeError("Unexpected extra inline script")
        js_blocks.append(code)
        generated[path] = code
        return '<script' + attrs + ' src="' + path + '"></script>'
    page = re.sub(r"<style>(.*?)</style>", style, page, flags=re.S)
    page = re.sub(r"<script([^>]*)>(.*?)</script>", script, page, flags=re.S | re.I)
    generated["index.html"] = page
    copy_line = 'if exist vendor xcopy /E /I /Y vendor "dist\\AI Studio Pro\\vendor"'
    if build.count(copy_line) != 1:
        raise RuntimeError("Unexpected build script")
    generated["build_exe.bat"] = build.replace(copy_line, copy_line + '\nif exist frontend xcopy /E /I /Y frontend "dist\\AI Studio Pro\\frontend"')
    before = method_map(src, "ChatEngine")
    after = {}
    for p, content in generated.items():
        if p.endswith(".py"):
            ast.parse(content, filename=p)
            if p.startswith("backend/") and p not in ("backend/document_export.py", "backend/shared.py"):
                after.update(method_map(content))
    if before != after:
        raise RuntimeError("Method AST changed or a method was lost")
    api_calls = set(re.findall(r"pywebview\.api\.(\w+)", "\n".join(js_blocks)))
    if api_calls - set(after):
        raise RuntimeError("Missing Python API methods: " + repr(api_calls - set(after)))
    # All validation above happens before replacing any source files.
    for p, content in generated.items():
        target = root / p
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content.encode("utf-8"))
    report = {"methods_preserved": len(before), "method_ast_sha256": {k: hashlib.sha256(v.encode()).hexdigest() for k, v in before.items()}, "api_methods_checked": len(api_calls),
              "inline_style_blocks_preserved": len(style_blocks), "inline_scripts_preserved": len(js_blocks),
              "generated_files": sorted(generated), "baseline_blob_shas": {p: blob_sha(v) for p, v in originals.items()}}
    (root / "REFACTOR_REPORT.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report

if __name__ == "__main__":
    print(json.dumps(migrate(Path(__file__).resolve().parents[1]), indent=2))
