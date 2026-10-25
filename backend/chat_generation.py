"""Dispatch generation using a chat-bound, in-memory provider snapshot."""
from copy import deepcopy
import threading
from .generation import GenerationMixin

class _ChatGenerationContext:
    @classmethod
    def for_chat_request(cls, engine, chat_id, profile_id, profile):
        context = object.__new__(cls)
        object.__setattr__(context, "_owner", engine)
        object.__setattr__(context, "current_chat_id", chat_id)
        object.__setattr__(context, "config", {"active_profile_id": profile_id, "profiles": {profile_id: deepcopy(profile)}})
        return context

    def __getattr__(self, name):
        return getattr(self._owner, name)

    def __setattr__(self, name, value):
        if name in ("config", "current_chat_id", "_owner"):
            raise AttributeError("Request routing is fixed for this generation")
        setattr(self._owner, name, value)

class ChatModelGenerationMixin:
    def send_chat_prompt_stream(self, user_prompt, file_data_list, params):
        with self.stream_lock:
            if getattr(self, "_chat_model_worker_running", False):
                return {"ok": False, "error": "generation_busy"}
            self._chat_model_worker_running = True
            self.is_aborted = False
            self.stream_gen += 1
            gen = self.stream_gen
            self.stream_chunk = ""
            self.stream_is_done = False
            self.stream_error = None
        try:
            if not isinstance(params, dict):
                raise ValueError("Invalid generation settings.")
            target = self.current_chat_id
            result = self.get_chat_model_binding(target)
            if not result.get("ok"):
                raise ValueError(result.get("message", "Select a provider and model for this chat."))
            if not result["remembered"]:
                binding = result["binding"]
                result = self.set_chat_model_binding(target, binding["profile_id"], binding["model_name"], binding["image_model"])
                if not result.get("ok"):
                    raise ValueError(result.get("message", "Could not remember this chat's model."))
            binding = deepcopy(result["binding"])
            profile = deepcopy(self.config.get("profiles", {}).get(binding["profile_id"]))
            if not isinstance(profile, dict):
                raise ValueError("The saved provider profile is missing.")
            profile["model_name"] = binding["model_name"]
            profile["image_model"] = binding["image_model"]
            context = _ChatGenerationContext.for_chat_request(self, target, binding["profile_id"], profile)
            settings = deepcopy(params)
            files = deepcopy(file_data_list)
            threading.Thread(target=self._run_chat_bound_worker, args=(context, gen, user_prompt, files, settings), daemon=True).start()
            return {"ok": True}
        except Exception:
            self._emit(gen, error="Could not start this chat's reply. Its saved provider/model may be missing or its model choice could not be saved. Select an existing provider/model for this chat and try again.", done=True)
            with self.stream_lock: self._chat_model_worker_running = False
            return {"ok": False, "error": "chat_model_unavailable"}

    def _run_chat_bound_worker(self, context, gen, prompt, files, params):
        known = None
        try:
            if hasattr(self, "_usage_known_node_ids"):
                known = self._usage_known_node_ids(context.current_chat_id)
        except Exception:
            known = None
        try:
            if self.is_aborted:
                self._emit(gen, chunk="*(Cancelled before generation started)*", done=True)
                return
            GenerationMixin._stream_worker(context, gen, prompt, files, params)
        except Exception:
            # Never include exception text that could contain provider credentials.
            self._emit(gen, error="The reply could not complete. Check the saved provider/model and try again.", done=True)
        finally:
            try:
                if known is not None:
                    self._usage_record_new_replies(context.current_chat_id, known)
            except Exception:
                pass   # a usage-count problem must never block the next reply
            with self.stream_lock: self._chat_model_worker_running = False
