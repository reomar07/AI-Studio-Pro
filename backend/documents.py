from .shared import *
from .shared import _ID_RE, _STATUS_PREFIX_RE

class DocumentsMixin:
    def save_code_to_file(self, code_string):
        try:
            dialog_type = getattr(webview.FileDialog, 'SAVE', getattr(webview, 'SAVE_DIALOG', 1))
            result = self._dialog_paths(webview.windows[0].create_file_dialog(dialog_type, save_filename='snippet.txt'))
            if not result: return None
            
            with open(result[0], 'w', encoding='utf-8') as f:
                f.write(code_string)
            js_toast("File saved successfully!")
            return True
        except Exception as e:
            js_toast(f"Save failed: {str(e)[:120]}")
            return False


    def export_chat_dialog(self, chat_id, export_format="md"):
        try:
            messages = self._public(self._get_linear_branch(self.history.get(chat_id)))
            if not messages: 
                js_toast("No messages to export.")
                return False
            
            content = ""
            if export_format == "json":
                content = json.dumps(messages, indent=2)
            else:
                content = f"# Chat Export: {messages[0].get('title', 'Conversation')}\n\n"
                for m in messages:
                    role_name = "**User**" if m['role'] == 'user' else "**Assistant**"
                    text = m.get('display_text', m.get('content', ''))
                    if isinstance(text, list): 
                        text = "\n".join([item.get('text', '') for item in text if item.get('type') == 'text'])
                    content += f"{role_name}:\n{text}\n\n---\n\n"
            
            dialog_type = getattr(webview.FileDialog, 'SAVE', getattr(webview, 'SAVE_DIALOG', 1))
            safe_title = "".join([c for c in messages[0].get('title', 'Conversation') if c.isalpha() or c.isdigit() or c==' ']).rstrip()
            safe_title = safe_title.replace(" ", "_")
            if not safe_title: safe_title = "Conversation"
            
            result = self._dialog_paths(webview.windows[0].create_file_dialog(
                dialog_type, 
                save_filename=f"{safe_title}.{export_format}"
            ))

            if result:
                with open(result[0], 'w', encoding='utf-8') as f:
                    f.write(content)
                js_toast(f"Success! Saved to: {result[0]}")
                return True
            else:
                js_toast("Export cancelled.")
                return False
        except Exception as e:
            js_toast(f"Export failed: {str(e)[:120]}")
            return False


    @staticmethod
    def _dialog_paths(result):
        """Different pywebview versions return a string or a list/tuple; always give a list."""
        if not result: return []
        if isinstance(result, str): return [result]
        return list(result)


    @staticmethod
    def _image_bytes(src):
        """Returns (bytes, extension) for a data: URL or an http(s) image link."""
        if src.startswith("data:"):
            head, _, b64 = src.partition(",")
            data = base64.b64decode(b64)
        elif src.startswith(("http://", "https://")):
            req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read(40 * 1024 * 1024)
        else:
            raise ValueError("Unsupported image address.")
        ext = "png"
        if data[:3] == b"\xff\xd8\xff": ext = "jpg"
        elif data[:4] == b"RIFF" and data[8:12] == b"WEBP": ext = "webp"
        elif data[:4] == b"GIF8": ext = "gif"
        return data, ext


    def _auto_store_image(self, src):
        """Keeps a copy of every generated image on disk (provider links expire after a while)."""
        try:
            data, ext = self._image_bytes(src)
            folder = os.path.join(DATA_DIR, "images")
            os.makedirs(folder, exist_ok=True)
            path = os.path.join(folder, f"image_{int(time.time() * 1000)}.{ext}")
            with open(path, "wb") as f: f.write(data)
            js_toast(f"Image copy kept in {folder}")
        except Exception:
            pass


    def save_message_image(self, chat_id, msg_id):
        try:
            node = self.history.get(chat_id, {}).get("nodes", {}).get(msg_id)
            src = (node or {}).get("image")
            if not src: js_toast("No image found in this message."); return False
            data, ext = self._image_bytes(src)
            dialog_type = getattr(webview.FileDialog, 'SAVE', getattr(webview, 'SAVE_DIALOG', 1))
            result = self._dialog_paths(webview.windows[0].create_file_dialog(dialog_type, save_filename=f"image.{ext}"))
            if not result: return False
            with open(result[0], "wb") as f: f.write(data)
            js_toast(f"Image saved: {result[0]}")
            return True
        except Exception as e:
            js_toast(f"Could not save the image (the link may have expired): {str(e)[:100]}")
            return False


    @staticmethod
    def _safe_filename(name):
        base = os.path.basename(str(name or "file")).replace("\x00", "")
        base = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", base).strip(" .") or "file"
        return base[:120]


    def _save_attachment(self, chat_id, f):
        """Keeps a copy of a file the user sent, so it can be opened again from the chat."""
        try:
            data_url = f.get("data", "")
            if "," not in data_url: return None
            raw = base64.b64decode(data_url.split(",", 1)[1])
            if len(raw) > 60 * 1024 * 1024: return None
            folder = os.path.join(ATTACH_DIR, re.sub(r"[^\w.-]", "_", str(chat_id)))
            os.makedirs(folder, exist_ok=True)
            path = os.path.join(folder, f"{int(time.time() * 1000)}_{self._safe_filename(f.get('name'))}")
            with open(path, "wb") as fh: fh.write(raw)
            return path
        except Exception:
            return None


    def _remove_attachment_folder(self, chat_id):
        try:
            folder = os.path.join(ATTACH_DIR, re.sub(r"[^\w.-]", "_", str(chat_id)))
            if os.path.isdir(folder): shutil.rmtree(folder, ignore_errors=True)
        except Exception:
            pass


    def open_attachment(self, chat_id, msg_id, index):
        """Opens a file you sent earlier with your normal program (PDF viewer, Word...)."""
        try:
            node = self.history.get(chat_id, {}).get("nodes", {}).get(msg_id) or {}
            files = node.get("files") or []
            f = files[int(index)] if 0 <= int(index) < len(files) else {}
            path = f.get("path")
            if not path or not os.path.exists(path):
                js_toast("The original file is not stored (only files sent after this update are kept).")
                return False
            real, base = os.path.realpath(path), os.path.realpath(ATTACH_DIR)
            if os.path.commonpath([real, base]) != base:
                js_toast("This file is outside the app's attachment folder, so it was not opened.")
                return False
            ext = real.rsplit(".", 1)[-1].lower() if "." in real else ""
            if ext in RISKY_EXTS:     # never run program-like files: just show them in their folder
                if hasattr(os, "startfile"): subprocess.Popen(["explorer", "/select,", real])
                else: webbrowser.open(os.path.dirname(real))
                js_toast("This file type could run code, so it was only shown in its folder.")
                return True
            if hasattr(os, "startfile"): os.startfile(real)
            else: webbrowser.open("file://" + real)
            return True
        except Exception as e:
            js_toast(f"Could not open the file: {str(e)[:100]}")
            return False


    def export_message(self, chat_id, msg_id, fmt, html_body=""):
        """Saves one reply as pdf (via the browser's print window), docx, html or md."""
        try:
            chat = self.history.get(chat_id) or {}
            node = (chat.get("nodes") or {}).get(msg_id)
            if not node:
                js_toast("Message not found."); return False
            text = node.get("display_text") or node.get("content") or ""
            if isinstance(text, list):
                text = "\n".join(i.get("text", "") for i in text if i.get("type") == "text")
            text = _STATUS_PREFIX_RE.sub("", text)
            title = next((n.get("title") for n in (chat.get("nodes") or {}).values() if n.get("parent") is None and n.get("title")), "AI Studio Pro")
            base = self._safe_filename(title)[:60] or "reply"

            if fmt == "pdf":
                os.makedirs(EXPORT_DIR, exist_ok=True)
                path = os.path.join(EXPORT_DIR, f"{base}_{int(time.time() * 1000)}.html")
                with open(path, "w", encoding="utf-8") as fh: fh.write(build_html_document(title, html_body, autoprint=True))
                import pathlib
                webbrowser.open(pathlib.Path(path).resolve().as_uri())
                js_toast("Your browser opens the print window. Choose 'Save as PDF' as the printer.")
                return True

            ext = {"docx": "docx", "html": "html", "md": "md"}.get(fmt)
            if not ext:
                js_toast("Unknown export format."); return False
            if fmt == "docx": payload = html_to_docx_bytes(html_body)
            elif fmt == "html": payload = build_html_document(title, html_body).encode("utf-8")
            else: payload = text.encode("utf-8")
            dialog_type = getattr(webview.FileDialog, 'SAVE', getattr(webview, 'SAVE_DIALOG', 1))
            result = self._dialog_paths(webview.windows[0].create_file_dialog(dialog_type, save_filename=f"{base}.{ext}"))
            if not result: return False
            with open(result[0], "wb") as fh: fh.write(payload)
            js_toast(f"Saved: {result[0]}")
            return True
        except Exception as e:
            js_toast(f"Export failed: {str(e)[:120]}")
            return False


    def _get_python_interpreter(self):
        if not getattr(sys, 'frozen', False):
            return sys.executable
        for cmd in ['python', 'py', 'python3']:
            found = shutil.which(cmd)
            if found and "windowsapps" not in found.lower():  # skip the Microsoft Store stub
                if os.path.abspath(found).lower() != os.path.abspath(sys.executable).lower():
                    return found
        possible_dirs = [
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Python"),
            r"C:\Python312", r"C:\Python311", r"C:\Python310", r"C:\Python39"
        ]
        for base in possible_dirs:
            if os.path.exists(base):
                for root, dirs, files in os.walk(base):
                    if "python.exe" in files:
                        p_path = os.path.join(root, "python.exe")
                        if "scripts" not in p_path.lower():
                            return p_path
        return None


    def execute_local_code(self, code_string):
        python_bin = self._get_python_interpreter()
        if not python_bin:
            return "Execution Error: Python is not installed or not in your Windows PATH. Please install Python to run scripts locally."
        
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as f:
                f.write(code_string)
                temp_path = f.name
            
            creation_flags = 0
            if sys.platform == 'win32':
                creation_flags = subprocess.CREATE_NO_WINDOW

            env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
            result = subprocess.run(
                [python_bin, temp_path],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                stdin=subprocess.DEVNULL,
                env=env,
                timeout=15,
                creationflags=creation_flags
            )
            output = result.stdout
            if result.stderr:
                output += f"\nErrors:\n{result.stderr}"
            output = output.strip()
            if len(output) > 20000: output = output[:20000] + "\n...[output cut]"
            return output or "Code executed successfully with no console output."
        except subprocess.TimeoutExpired:
            return "Execution Error: Script timed out after 15 seconds."
        except Exception as e:
            return f"Execution Error: {str(e)}"
        finally:
            if temp_path and os.path.exists(temp_path):
                try: os.remove(temp_path)
                except: pass


    def _process_frontend_file(self, file_obj, pdf_images=False):
        try:
            name, data_url = file_obj.get("name", "unnamed"), file_obj.get("data", "")
            ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
            if not data_url or "," not in data_url: return None
            header, b64_data = data_url.split(",", 1)

            if ext in ['png', 'jpg', 'jpeg', 'webp', 'gif'] or header.startswith("data:image/") and ext not in BINARY_EXTS:
                return {"name": name, "is_image": True, "data_url": data_url}
            raw_bytes = base64.b64decode(b64_data)
            text = None
            extra_images = []
            if ext == 'pdf':
                with pymupdf.open(stream=raw_bytes, filetype="pdf") as pdf:
                    text = "\n".join(p.get_text() for p in pdf)
                    scanned = len(text.strip()) < 30
                    if scanned or pdf_images:      # show the pages to the model as pictures
                        for i, page in enumerate(pdf):
                            if i >= MAX_PDF_IMAGE_PAGES: break
                            try:
                                pix = page.get_pixmap(dpi=130)
                                try: img, mime = pix.tobytes("jpeg"), "jpeg"
                                except Exception: img, mime = pix.tobytes("png"), "png"
                                extra_images.append(f"data:image/{mime};base64," + base64.b64encode(img).decode())
                            except Exception:
                                break
                if scanned:
                    if extra_images:
                        text = (f"[This PDF has no readable text, so its first {len(extra_images)} page(s) are attached below as images. "
                                "Read them carefully and do not invent details you cannot actually see.]")
                    else:
                        text = "[This PDF has no readable text - it may be a scanned image, and the pages could not be converted to pictures.]"
                elif extra_images:
                    text += (f"\n\n[The first {len(extra_images)} page(s) of this PDF are also attached as images so you can see the real layout "
                             "(tables, columns). Use the images for layout and the extracted text for exact spelling.]")
            elif ext == 'docx':
                if not docx: text = "[Cannot read .docx: run  pip install python-docx  and restart the app.]"
                else:
                    import io
                    d = docx.Document(io.BytesIO(raw_bytes))
                    parts = [p.text for p in d.paragraphs]
                    for t in d.tables:
                        for row in t.rows: parts.append(" | ".join(c.text for c in row.cells))
                    text = "\n".join(parts)
            elif ext in BINARY_EXTS or b"\x00" in raw_bytes[:4096]:
                text = f"[File '{name}' is a binary file type and cannot be read as text.]"
            else:
                text = raw_bytes.decode('utf-8', errors='ignore')
            if len(text) > MAX_DOC_CHARS: text = text[:MAX_DOC_CHARS] + "\n...[document cut: too long]"
            return {"name": name, "is_image": False, "text": text, "extra_images": extra_images}
        except Exception as e:
            return {"name": file_obj.get("name", "file"), "is_image": False, "text": f"[Could not read this file: {e}]"}

