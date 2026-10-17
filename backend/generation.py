from .shared import *
from .shared import _ID_RE, _STATUS_PREFIX_RE

class GenerationMixin:
    def poll_stream(self):
        with self.stream_lock:
            chunk = self.stream_chunk
            self.stream_chunk = ""
            done = self.stream_is_done
            error = self.stream_error
            if done:
                self.stream_error = None
                self.stream_is_done = False
            return {"chunk": chunk, "done": done, "error": error}


    def open_external_url(self, url):
        if url and (url.startswith("http://") or url.startswith("https://")):
            webbrowser.open(url)
            return True
        return False


    def get_version(self):
        return APP_VERSION


    def stop_generation(self):
        self.is_aborted = True
        if self.active_stream:
            try: self.active_stream.close()
            except: pass


    @staticmethod
    def _clean_title(raw, prompt):
        """Short, clean chat title. Falls back to the first words of the user's message if the model returns junk."""
        fallback = re.sub(r"\s+", " ", str(prompt or "Conversation")).strip()[:28] or "Conversation"
        t = re.sub(r"<think>.*?</think>", "", str(raw or ""), flags=re.S | re.I)
        t = re.sub(r"<[^>]*>", "", t)
        t = t.strip().splitlines()[0].strip() if t.strip() else ""
        t = re.sub(r"[*#_`>\"]", "", t).strip(" .:-")
        if not t or len(t.split()) > 8 or len(t) > 60 or t.lower().startswith(BAD_TITLE_STARTS):
            return fallback
        return t


    def _repair_bad_titles(self):
        """Fix titles saved by older versions when a reasoning model wrote its thoughts as the title."""
        changed = False
        for chat in self.history.values():
            nodes = chat.get("nodes", {}) if isinstance(chat, dict) else {}
            for node in nodes.values():
                if node.get("parent") is None and node.get("role") == "user":
                    title = str(node.get("title", ""))
                    if title and (len(title) > 60 or title.lower().startswith(BAD_TITLE_STARTS) or "**" in title):
                        node["title"] = self._clean_title(title, node.get("display_text") or "Conversation")
                        changed = True
        if changed: self._save_json(HISTORY_FILE, self.history)


    def _generate_title_thread(self, chat_id, prompt_text, profile):
        try:
            custom_headers_raw = (profile.get("custom_headers") or "").strip()
            headers = json.loads(custom_headers_raw) if custom_headers_raw.startswith("{") else None
            client = OpenAI(base_url=profile.get("base_url") or None, api_key=profile.get("api_key") or "none", default_headers=headers, timeout=60.0)
            response = client.chat.completions.create(
                model=profile.get("model_name") or "gpt-4o",
                messages=[{"role": "system", "content": "Summarize this user request in 2 to 4 words. Respond ONLY with the title. No quotes, no punctuation."}, {"role": "user", "content": str(prompt_text)[:500]}],
                max_tokens=40, temperature=0.3
            )
            title = self._clean_title(response.choices[0].message.content, prompt_text)
            chat = self.history.get(chat_id)
            if chat and chat.get("current_node"):
                curr = chat["current_node"]
                while chat["nodes"][curr]["parent"]: curr = chat["nodes"][curr]["parent"]
                chat["nodes"][curr]["title"] = title
                self._save_json(HISTORY_FILE, self.history)
        except Exception: pass


    def _emit(self, gen, chunk=None, error=None, done=False):
        """Send text/errors/'finished' to the page, but only if this worker is still the current one."""
        with self.stream_lock:
            if gen != self.stream_gen: return
            if chunk: self.stream_chunk += chunk
            if error: self.stream_error = error
            if done: self.stream_is_done = True


    def _add_error_node(self, chat_id, text):
        nid = self._add_node(chat_id, "assistant", text, text, "", False)
        self.history[chat_id]["nodes"][nid]["is_error"] = True
        return nid


    def _turn_content(self, m, limit=None):
        """Content to send to the model for a stored message (includes attached document text)."""
        content = m.get("content", "")
        llm_text = m.get("llm_text")
        if llm_text:
            if isinstance(content, list):
                content = copy.deepcopy(content)
                for item in content:
                    if item.get("type") == "text":
                        item["text"] = llm_text
                        break
                else:
                    content.insert(0, {"type": "text", "text": llm_text})
            else:
                content = llm_text
        if limit:
            if isinstance(content, str) and len(content) > limit:
                content = content[:limit] + "\n...[older message shortened]..."
            elif isinstance(content, list):
                content = copy.deepcopy(content)
                for item in content:
                    if item.get("type") == "text" and isinstance(item.get("text"), str) and len(item["text"]) > limit:
                        item["text"] = item["text"][:limit] + "\n...[older message shortened]..."
        return content


    def send_prompt_stream(self, user_prompt, file_data_list, params):
        with self.stream_lock:
            self.is_aborted = False
            self.stream_gen += 1
            gen = self.stream_gen
            self.stream_chunk = ""
            self.stream_is_done = False
            self.stream_error = None
        threading.Thread(target=self._stream_worker, args=(gen, user_prompt, file_data_list, params), daemon=True).start()


    def _stream_worker(self, gen, user_prompt, file_data_list, params):
        sources_list = []
        target_chat = self.current_chat_id
        if target_chat not in self.history:
            self.history[target_chat] = {"nodes": {}, "current_node": None}

        self.chat_settings[target_chat] = params
        self._save_json(SETTINGS_FILE, self.chat_settings)

        active_id = self.config.get("active_profile_id", "default")
        profile = self.config.get("profiles", {}).get(active_id, {})
        if profile:   # use ONLY the chosen profile (never borrow another profile's key)
            api_key = profile.get("api_key") or ""
            base_url = profile.get("base_url") or ""
            model_name = profile.get("model_name") or "google/gemini-2.0-flash-001"
        else:
            api_key = self.config.get("api_key", "")
            base_url = self.config.get("base_url", "")
            model_name = self.config.get("model_name") or "google/gemini-2.0-flash-001"

        custom_headers_raw = (profile.get("custom_headers") or "").strip()
        custom_headers = None
        if custom_headers_raw.startswith("{") and custom_headers_raw.endswith("}"):
            try: custom_headers = json.loads(custom_headers_raw)
            except Exception: self._emit(gen, chunk="> ⚠️ *Custom headers are not valid JSON and were ignored.*\n\n")

        is_image_gen = params.get("is_image_mode", False)
        is_regenerate = params.get("regenerate", False)
        active_workspace = params.get("active_workspace")

        is_local = any(h in str(base_url) for h in LOCAL_HOSTS)
        if not api_key and not is_local:
            if not is_regenerate:
                self._add_node(target_chat, "user", user_prompt, user_prompt, (user_prompt or "Chat")[:28], False)
            err_msg = "**Configuration Warning**: No API Key detected. Please open Settings and configure your Provider Profile."
            self._add_error_node(target_chat, err_msg)
            self._save_json(HISTORY_FILE, self.history)
            self._emit(gen, error=err_msg, done=True)
            return
        if not api_key: api_key = "not-needed"

        current_turn_payload = None
        workspace_sources = []
        if not is_regenerate:
            doc_texts, image_urls, doc_meta_list = [], [], []

            if file_data_list:
                for f in file_data_list:
                    processed = self._process_frontend_file(f, pdf_images=bool(params.get("pdf_images")))
                    if not processed: continue
                    if processed["is_image"]: image_urls.append(processed["data_url"])
                    else:
                        doc_texts.append(f"--- Document: {processed['name']} ---\n{processed['text']}")
                        meta = {"name": processed["name"]}
                        saved = self._save_attachment(target_chat, f)     # keep the original so it can be opened later
                        if saved: meta["path"] = saved
                        doc_meta_list.append(meta)
                        image_urls.extend(processed.get("extra_images") or [])

            workspace_context = ""
            if active_workspace and user_prompt and user_prompt.strip():
                engine, docs, metas = self.bm25_engine, self.workspace_docs, self.workspace_meta   # snapshot
                if not engine:
                    self._emit(gen, chunk="> ⚠️ *The workspace folder is still being scanned or has no readable files.*\n\n")
                else:
                    try:
                        scores = engine.get_scores(self._tokenize(user_prompt))
                        top = [i for i in sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:6] if scores[i] > 0 and i < len(docs)]
                        if top:
                            workspace_context += f"\n[Local Workspace Files: {active_workspace}]\n"
                            for idx in top:
                                workspace_context += f"--- File: {metas[idx]['filename']} ---\n{docs[idx]}\n\n"
                                fname = metas[idx]["filename"]
                                existing = next((s for s in workspace_sources if s["file"] == fname), None)
                                if existing:
                                    existing["chunks"] += 1
                                    existing["snippet"] += "\n\n[...]\n\n" + docs[idx][:400]
                                else:
                                    workspace_sources.append({"file": fname, "chunks": 1, "snippet": docs[idx][:600]})
                        else:
                            self._emit(gen, chunk="> ℹ️ *No matching text found in the workspace for this question.*\n\n")
                    except Exception: pass

            is_web_search = params.get("web_search", False)
            web_context = ""
            if is_web_search and user_prompt and user_prompt.strip():
                try:
                    self._emit(gen, chunk="> 🌐 *Searching live web...*\n\n")
                    query = " ".join(user_prompt.split())[:300]
                    results = list(DDGS().text(query, max_results=4))
                    if results:
                        web_context += "\n[Live Web Search Reference Material]\n"
                        for res in results:
                            title = str(res.get('title', 'Web Result'))
                            url = str(res.get('href', ''))
                            body = str(res.get('body', ''))
                            if url.startswith("http://") or url.startswith("https://"):
                                sources_list.append({"title": title, "url": url})
                                web_context += f"Source: {title} ({url})\nSnippet: {body}\n\n"
                    else:
                        web_context += "\n[Live Web Search: No matching results found online.]\n"
                except Exception as e:
                    self._emit(gen, chunk=f"> ⚠️ *Web search failed ({str(e)[:100]}). Answering without it.*\n\n")

            prompt_for_model = user_prompt if (user_prompt and user_prompt.strip()) else ("(see the attached file)" if (doc_texts or image_urls) else "")
            has_extra = bool(doc_texts or workspace_context or web_context)
            combined_text = ""
            if has_extra:
                if workspace_context: combined_text += f"{workspace_context}\n"
                if doc_texts: combined_text += "\n\n".join(doc_texts) + "\n\n"
                if web_context: combined_text += f"{web_context}\n"
                combined_text += f"User Request: {prompt_for_model}"

            if image_urls or has_extra:
                current_turn_payload = [{"type": "text", "text": combined_text or prompt_for_model}]
                for url in image_urls: current_turn_payload.append({"type": "image_url", "image_url": {"url": url}})
            else:
                current_turn_payload = prompt_for_model

            if image_urls:
                clean_history_content = [{"type": "text", "text": prompt_for_model}]
                for url in image_urls: clean_history_content.append({"type": "image_url", "image_url": {"url": url}})
            else:
                clean_history_content = prompt_for_model

            display_title = (user_prompt or "Attachment")[:28]
            display_label = user_prompt or f"[{len(file_data_list or [])} Files Attached]"
            primary_image = image_urls[0] if image_urls else None

            nid = self._add_node(target_chat, "user", clean_history_content, display_label, display_title, is_image_gen, files=doc_meta_list, image=primary_image)
            if has_extra:   # remember the attached text so follow-ups and Regenerate still see it
                self.history[target_chat]["nodes"][nid]["llm_text"] = combined_text
                self.history[target_chat]["nodes"][nid]["ctx_sources"] = {"web": sources_list, "workspace": workspace_sources}

            if len(self._get_linear_branch(self.history[target_chat])) == 1 and not is_image_gen:
                threading.Thread(target=self._generate_title_thread, args=(target_chat, user_prompt or "Attachment", {"api_key": api_key, "base_url": base_url, "model_name": model_name, "custom_headers": profile.get("custom_headers", "")}), daemon=True).start()

        linear_history = self._get_linear_branch(self.history[target_chat])
        if is_regenerate and linear_history:      # keep the same sources when an answer is regenerated
            ctx = linear_history[-1].get("ctx_sources") or {}
            sources_list = list(ctx.get("web", []))
            workspace_sources = list(ctx.get("workspace", []))
        client = OpenAI(base_url=base_url or None, api_key=api_key, default_headers=custom_headers, timeout=120.0)
        assistant_node_id = None
        full_reply = ""

        if is_image_gen:
            try:
                img_prompt = linear_history[-1].get("display_text", "") if linear_history else ""
                image_model = profile.get("image_model") or "dall-e-3"
                response = client.images.generate(model=image_model, prompt=img_prompt, size="1024x1024", n=1)
                item = response.data[0]
                img_url = getattr(item, "url", None)
                if not img_url and getattr(item, "b64_json", None):
                    img_url = "data:image/png;base64," + item.b64_json
                if not img_url: raise RuntimeError("The provider returned no image. Check that your provider supports image generation.")
                output_md = f"![Generated Image]({img_url})"
                if not img_url.startswith("data:"): output_md += f"\n\n[Open Full Size Image]({img_url})"
                nid = self._add_node(target_chat, "assistant", output_md, output_md, "", False, image=img_url)
                self.history[target_chat]["nodes"][nid]["model"] = profile.get("image_model") or "dall-e-3"
                self._save_json(HISTORY_FILE, self.history)
                self._emit(gen, chunk=output_md, done=True)
                threading.Thread(target=self._auto_store_image, args=(img_url,), daemon=True).start()
            except Exception as e:
                err = "**Image generation failed.** Not every provider supports images - check yours.\n\n" + friendly_error(e)
                self._add_error_node(target_chat, err)
                self._save_json(HISTORY_FILE, self.history)
                self._emit(gen, error=err, done=True)
            return

        try:
            limit = params.get("context_limit", 10)
            user_system = (params.get("system_prompt") or "").strip()
            messages_payload = [{"role": "system", "content": APP_NOTE + ("\n\n" + user_system if user_system else "")}]

            earlier = []
            for m in linear_history[:-1]:      # leave out failed turns so errors never confuse the model
                if m.get("is_error"):
                    if earlier and earlier[-1]["role"] == "user": earlier.pop()
                    continue
                earlier.append(m)
            for m in earlier[-(limit - 1):] if limit > 1 else []:
                messages_payload.append({"role": m["role"], "content": self._turn_content(m, 8000)})

            if linear_history:
                last_turn = linear_history[-1]
                active_content = current_turn_payload if (current_turn_payload and not is_regenerate) else self._turn_content(last_turn)
                messages_payload.append({"role": last_turn["role"], "content": active_content})

            kwargs = dict(model=model_name, messages=messages_payload, stream=True,
                          temperature=params.get("temperature", 0.7), stream_options={"include_usage": True})
            while True:   # drop settings that this provider/model refuses, then try again
                try:
                    self.active_stream = client.chat.completions.create(**kwargs)
                    break
                except Exception as setup_err:
                    text = str(setup_err).lower()
                    if "stream_options" in kwargs and ("stream_options" in text or "include_usage" in text or isinstance(setup_err, openai.BadRequestError)):
                        kwargs.pop("stream_options")
                    elif "temperature" in kwargs and "temperature" in text:
                        kwargs.pop("temperature")
                    else:
                        raise

            assistant_node_id = self._add_node(target_chat, "assistant", "", "", "", False)

            if active_workspace and not is_regenerate and self.bm25_engine:
                status_msg = f"> 📂 *Scanned local workspace ({active_workspace}).*\n\n"
                full_reply += status_msg
                self._emit(gen, chunk=status_msg)

            model_text = ""
            usage = None
            cancel_msg = "\n\n*(Cancelled by user)*"
            try:
                for chunk in self.active_stream:
                    if self.is_aborted or gen != self.stream_gen:
                        try: self.active_stream.close()
                        except Exception: pass
                        full_reply += cancel_msg
                        self._emit(gen, chunk=cancel_msg)
                        break
                    if getattr(chunk, "usage", None): usage = chunk.usage
                    if chunk.choices and chunk.choices[0].delta.content:
                        token = chunk.choices[0].delta.content
                        model_text += token
                        full_reply += token
                        self._emit(gen, chunk=token)
            except Exception:
                if not (self.is_aborted or gen != self.stream_gen): raise
                if cancel_msg not in full_reply:        # stream was closed by the Stop button: keep what we have
                    full_reply += cancel_msg
                    self._emit(gen, chunk=cancel_msg)

            if not model_text.strip() and cancel_msg not in full_reply:
                note = "*(The model returned an empty reply. Try again or pick another model.)*"
                full_reply += note
                self._emit(gen, chunk=note)

            node = self.history[target_chat]["nodes"][assistant_node_id]
            node["content"] = full_reply
            node["display_text"] = full_reply
            node["sources"] = sources_list
            node["workspace_sources"] = workspace_sources
            node["model"] = model_name
            if usage is not None:
                node["usage"] = {"prompt": getattr(usage, "prompt_tokens", None), "completion": getattr(usage, "completion_tokens", None)}
            self._save_json(HISTORY_FILE, self.history)
            self._emit(gen, done=True)

        except Exception as e:
            err = "\n\n" + friendly_error(e)
            if assistant_node_id:
                node = self.history[target_chat]["nodes"][assistant_node_id]
                node["content"] = full_reply + err
                node["display_text"] = full_reply + err
                node["is_error"] = True
            else:
                self._add_error_node(target_chat, err)
            self._save_json(HISTORY_FILE, self.history)
            self._emit(gen, error=err, done=True)

