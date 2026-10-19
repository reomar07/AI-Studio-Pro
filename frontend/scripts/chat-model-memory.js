/**
 * Per-chat model memory (add-on, loaded AFTER app.js).
 * Restores each chat's saved provider/model into the model display when you
 * open a chat, and updates that chat's binding when you pick a new model.
 * Does not modify app.js; falls back silently if the backend hook is missing.
 */
(function () {
  if (!window.pywebview || !window.pywebview.api) return;

  var api = window.pywebview.api;
  var currentChat = null;
  var restoring = false;

  function validId(v) {
    return typeof v === "string" && v.length > 0 && v.length <= 128 && v === v.trim();
  }

  function currentModelText() {
    var el = document.getElementById("active-model-display");
    return el ? String(el.innerText || "").trim() : "";
  }

  function setModelDisplay(text) {
    var el = document.getElementById("active-model-display");
    if (el && text) el.innerText = text;
  }

  function toast(msg) {
    if (typeof showToast === "function") { try { showToast(msg); } catch (e) {} }
  }

  // When a chat opens, show ITS saved model instead of the global default.
  async function restoreForChat(chatId) {
    if (restoring) return;
    restoring = true;
    try {
      if (typeof api.get_chat_model_binding !== "function") return;
      var r = await api.get_chat_model_binding(chatId);
      if (!r || !r.ok || !r.binding || !r.binding.model_name) {
        // Legacy/unknown/damaged: keep whatever the global display shows.
        return;
      }
      var b = r.binding;
      var label = (typeof modelDisplayName === "function")
        ? modelDisplayName(b.model_name)
        : b.model_name;
      if (validId(b.profile_id) && currentModelText() !== label) setModelDisplay(label);
    } catch (e) {
      // Never break chat opening if the memory backend is unavailable.
    } finally {
      restoring = false;
    }
  }

  // Track which chat is open. renderChat() calls this with the new chat id.
  if (typeof api.set_current_chat_id === "function") {
    var origSetCurrent = api.set_current_chat_id;
    api.set_current_chat_id = async function (id) {
      var res = await origSetCurrent.apply(api, arguments);
      currentChat = (typeof id === "string") ? id : null;
      await restoreForChat(currentChat);
      return res;
    };
  }

  // Choosing a model (model list, custom entry) or saving settings also
  // updates the CURRENT chat's binding so its next reply uses that choice.
  if (typeof api.save_config === "function" && typeof api.set_chat_model_binding === "function") {
    var origSaveConfig = api.save_config;
    api.save_config = async function (cfg) {
      var res = await origSaveConfig.apply(api, arguments);
      try {
        if (!currentChat || !cfg || !cfg.profiles || !cfg.active_profile_id) return res;
        var p = cfg.profiles[cfg.active_profile_id];
        if (!p || !validId(String(p.model_name || ""))) return res;
        var r = await api.set_chat_model_binding(currentChat, cfg.active_profile_id, p.model_name, p.image_model);
        if (!r || !r.ok) {
          var why = (r && r.error) ? r.error : "unknown";
          if (why === "save_failed") toast("Could not save this chat's model choice.");
          else if (why === "missing_profile" || why === "invalid_model") toast("Model choice was not saved for this chat.");
          // else: chat not created yet - nothing to do.
        }
      } catch (e) { /* keep the original save result */ }
      return res;
    };
  }
})();
