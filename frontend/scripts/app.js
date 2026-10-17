
    function initTheme() {
      const isDark = localStorage.getItem('theme') !== 'light';
      if (isDark) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
      document.getElementById('theme-icon').innerText = isDark ? "☀️" : "🌙";
    }
    initTheme();

    function toggleTheme() {
      const html = document.documentElement;
      const isDark = html.classList.toggle('dark');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      document.getElementById('theme-icon').innerText = isDark ? "☀️" : "🌙";
    }

    const KNOWN_MODELS = [
      { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash" },
      { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet" },
      { id: "openai/gpt-4o", name: "GPT-4o" },
      { id: "openai/o3-mini", name: "o3-mini Reasoning" },
      { id: "deepseek/deepseek-r1", name: "DeepSeek R1" },
      { id: "deepseek/deepseek-chat", name: "DeepSeek V3" }
    ];

    let isGenerating = false, isImageMode = false;
    let currentStreamElement = null, rawStreamBuffer = "";
    let fullChatCache = {}, metadataCache = {}, activeChatId = null;
    let attachedFiles = [], globalConfig = null, userScrolledUp = false;
    let activeWorkspace = null, snippetCache = [], isWebSearchActive = false;
    let streamInterval = null, tokenParseTimeout = null;
    const PAGE_VERSION = "1.2.1";   // must match APP_VERSION in app-2.py
    const DEFAULT_PROFILES = { profiles: { default: { name: "OpenRouter" } } };
    const DEFAULT_PLACEHOLDER = "Type your question, paste images, or press ^ to edit...";
    let currentModels = KNOWN_MODELS.slice(), modelsLive = false;

    // Turns any text into harmless text for use inside HTML (stops "<img onerror=...>" tricks).
    function esc(s) {
      return String(s === undefined || s === null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    // Like encodeURIComponent but also protects apostrophes (they broke the Edit button).
    function encAttr(s) { return encodeURIComponent(s === undefined || s === null ? "" : s).replace(/'/g, "%27"); }
    // Ids go into inline click handlers, so only plain characters are allowed (blocks tricks via damaged or imported data).
    function sid(x) { return String(x === undefined || x === null ? "" : x).replace(/[^\w.-]/g, "_"); }
    function numOr(v, d) { const n = parseFloat(v); return isNaN(n) ? d : n; }

    function showChatView() {
      document.getElementById('empty-state').classList.add('hidden');
      document.getElementById('chat-messages').classList.remove('hidden');
    }

    function showEmptyState() {
      document.getElementById('empty-state').classList.remove('hidden');
      document.getElementById('chat-messages').classList.add('hidden');
    }

    function showToast(msg) {
        const toast = document.createElement('div');
        toast.className = "fixed top-5 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-full shadow-2xl z-[100] text-sm font-semibold transition-opacity duration-300";
        toast.innerText = msg;
        document.body.appendChild(toast);
        setTimeout(function() { toast.style.opacity = '0'; setTimeout(function() { toast.remove(); }, 300); }, 5000);
    }

    function toggleWebSearch() {
        isWebSearchActive = !isWebSearchActive;
        const btn = document.getElementById('btn-web-search');
        if (isWebSearchActive) {
            btn.classList.add('bg-blue-600', 'text-white');
            btn.classList.remove('hover:text-black', 'dark:hover:text-white', 'hover:bg-zinc-200', 'dark:hover:bg-[#3f3f46]');
            showToast('Web Search Enabled');
        } else {
            btn.classList.remove('bg-blue-600', 'text-white');
            btn.classList.add('hover:text-black', 'dark:hover:text-white', 'hover:bg-zinc-200', 'dark:hover:bg-[#3f3f46]');
            showToast('Web Search Disabled');
        }
    }

    async function exportChatLocal(fmt) {
      if (!activeChatId) return showToast("No active chat to export.");
      showToast("Opening Save Dialog...");
      await window.pywebview.api.export_chat_dialog(activeChatId, fmt);
    }

    async function attachWorkspace() {
        const folderName = await window.pywebview.api.attach_workspace();
        if (folderName) {
            activeWorkspace = folderName;
            document.getElementById('workspace-badge').classList.remove('hidden');
            document.getElementById('workspace-name').innerText = folderName;
        }
    }

    function clearWorkspace() {
        activeWorkspace = null;
        document.getElementById('workspace-badge').classList.add('hidden');
    }

    let speechRecognition;
    let isDictating = false;
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
      speechRecognition = new SpeechAPI();
      speechRecognition.continuous = true;
      speechRecognition.interimResults = true;
      speechRecognition.onresult = function(e) {
        let finalTranscript = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) { 
          if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript; 
        }
        if(finalTranscript) {
           const input = document.getElementById('prompt-input');
           input.value += (input.value ? ' ' : '') + finalTranscript;
           handleInputTelemetry(input);
        }
      };
      speechRecognition.onerror = function() { if (isDictating) toggleDictation(); };
      speechRecognition.onend = function() { 
        if(isDictating) {
          try { speechRecognition.start(); }
          catch(err) { isDictating = false; document.getElementById('btn-dictate').classList.remove('recording'); }
        } else { document.getElementById('btn-dictate').classList.remove('recording'); }
      };
    }

    function toggleDictation() {
      if(!speechRecognition) return alert("Browser does not support Dictation.");
      const btn = document.getElementById('btn-dictate');
      if (isDictating) { isDictating = false; speechRecognition.stop(); btn.classList.remove('recording'); } 
      else { try { speechRecognition.start(); isDictating = true; btn.classList.add('recording'); } catch (err) { isDictating = false; } }
    }

    async function toggleSnippets() {
      const modal = document.getElementById('snippet-modal');
      if (modal.classList.contains('hidden')) {
        snippetCache = await window.pywebview.api.get_prompts();
        renderSnippetList();
        if(snippetCache.length > 0) loadSnippetIntoEditor(snippetCache[0]);
      }
      modal.classList.toggle('hidden');
    }

    function renderSnippetList() {
      const list = document.getElementById('snippet-list'); list.innerHTML = "";
      snippetCache.forEach(function(snip) {
        const div = document.createElement('div');
        div.className = "px-3 py-2 bg-zinc-100 dark:bg-[#2a2a2c] hover:bg-zinc-200 dark:hover:bg-[#3f3f46] rounded cursor-pointer transition text-sm text-black dark:text-zinc-300 truncate";
        div.innerText = snip.title || "Untitled"; 
        div.onclick = function() { loadSnippetIntoEditor(snip); };
        list.appendChild(div);
      });
    }

    function loadSnippetIntoEditor(snip) {
      document.getElementById('snip-id').value = snip.id || ""; 
      document.getElementById('snip-title').value = snip.title || "";
      document.getElementById('snip-content').value = snip.content || ""; 
      document.getElementById('btn-del-snip').classList.toggle('hidden', !snip.id);
    }

    function createNewSnippet() {
      document.getElementById('snip-id').value = ""; document.getElementById('snip-title').value = ""; document.getElementById('snip-content').value = "";
      document.getElementById('btn-del-snip').classList.add('hidden'); document.getElementById('snip-title').focus();
    }

    async function saveActiveSnippet() {
      const id = document.getElementById('snip-id').value, title = document.getElementById('snip-title').value || "Untitled", content = document.getElementById('snip-content').value;
      snippetCache = await window.pywebview.api.save_prompt(title, content, id || null);
      renderSnippetList(); 
      const newSnip = snippetCache.find(function(s) { return s.title === title && s.content === content; }); 
      if(newSnip) loadSnippetIntoEditor(newSnip);
    }

    async function deleteActiveSnippet() {
      const id = document.getElementById('snip-id').value; if (!id) return;
      snippetCache = await window.pywebview.api.delete_prompt(id);
      renderSnippetList(); 
      if(snippetCache.length > 0) loadSnippetIntoEditor(snippetCache[0]); 
      else createNewSnippet();
    }

    function injectSnippet(target) {
      const content = document.getElementById('snip-content').value; if (!content) return;
      if (target === 'system') { document.getElementById('param-system').value = content; toggleSnippets(); toggleChatSettings(); } 
      else { const input = document.getElementById('prompt-input'); input.value = input.value + (input.value ? '\n' : '') + content; handleInputTelemetry(input); toggleSnippets(); input.focus(); }
    }

    window.addEventListener("keydown", function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); newChat(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggleSearch(); }
      else if (e.key === 'Escape') {
        document.getElementById('chat-settings-modal').classList.add('hidden'); document.getElementById('global-settings-modal').classList.add('hidden');
        document.getElementById('model-dropdown').classList.add('hidden'); document.getElementById('snippet-modal').classList.add('hidden'); document.getElementById('export-modal').classList.add('hidden');
      }
    });

    function handleKeyNavigation(event) {
      if (event.key === 'ArrowUp' && event.target.value === '') {
        event.preventDefault(); 
        const currentMsgs = fullChatCache[activeChatId];
        if (currentMsgs && currentMsgs.length > 0) {
          for (let i = currentMsgs.length - 1; i >= 0; i--) { 
            if (currentMsgs[i].role === 'user') { editMessageDirect(typeof currentMsgs[i].display_text === 'string' ? currentMsgs[i].display_text : (typeof currentMsgs[i].content === 'string' ? currentMsgs[i].content : ''), currentMsgs[i].id); break; } 
          }
        }
      } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); handleAction(); }
    }

    function estimateTokens(str) { return Math.ceil((typeof str === 'string' ? str : '').trim().length / 4); }
    function handleInputTelemetry(el) { el.style.height = ''; el.style.height = el.scrollHeight + 'px'; if (activeChatId) localStorage.setItem("draft_" + activeChatId, el.value); }

    const chatBox = document.getElementById('chat-messages');
    chatBox.addEventListener('scroll', function() { userScrolledUp = (chatBox.scrollHeight - chatBox.scrollTop > chatBox.clientHeight + 20); });

    document.addEventListener('click', function(e) {
      // Links in chat replies must open in your normal browser, never replace this app window.
      const link = e.target.closest('a[href]');
      if (link) {
        e.preventDefault();
        const href = link.getAttribute('href') || '';
        if (/^https?:\/\//i.test(href)) window.pywebview.api.open_external_url(href);
        return;
      }
      const target = e.target.closest('[data-action]');
      if (!target) return;
      // Buttons that appear INSIDE a model reply are untrusted (a reply could contain fake buttons). Ignore them.
      if (target.closest('.prose')) return;
      const action = target.getAttribute('data-action');
      const payload = target.getAttribute('data-payload') ? decodeURIComponent(target.getAttribute('data-payload')) : '';

      if (action === 'copy-text') {
        copyToClipboard(payload);
        const orig = target.innerText; target.innerText = "Copied!"; setTimeout(function() { target.innerText = orig; }, 2000);
      }
      else if (action === 'listen-text') { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(payload.replace(/[#*\x60_]/g, ''))); }
      else if (action === 'open-url') { window.pywebview.api.open_external_url(payload); }
    });

    function copyToClipboard(text) {
      try { navigator.clipboard.writeText(text).catch(function() { fallbackCopy(text); }); } catch (e) { fallbackCopy(text); }
    }
    function fallbackCopy(text) {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove();
    }

    async function runCodeWithConfirmation(btn, code, box) {
        const preview = code.length > 1500 ? (code.substring(0, 1500) + "\n... (" + (code.length - 1500) + " more characters not shown!)") : code;
        const confirmed = confirm("SECURITY WARNING:\nYou are about to execute this Python script locally on your PC:\n\n" + preview + "\n\nDo you want to run this script?");
        if (!confirmed) return;

        const outputDiv = box.querySelector('.code-output');
        btn.textContent = "Running..."; outputDiv.classList.remove('hidden'); outputDiv.innerText = "Executing script locally...";
        try {
            const result = await window.pywebview.api.execute_local_code(code);
            outputDiv.innerText = result;
        } catch (err) {
            outputDiv.innerText = "Execution Error: " + err;
        }
        btn.textContent = "▶ Run Local";
    }

    // The markdown renderer only produces a plain code box. The buttons are added afterwards by
    // decorateCodeBlocks(), so a model reply can never smuggle in its own "Run" buttons.
    const renderer = new marked.Renderer();
    renderer.code = function(tokenOrCode, langOrUndefined) {
      const isObj = typeof tokenOrCode === 'object';
      const code = isObj ? tokenOrCode.text : tokenOrCode;
      const rawLang = isObj ? (tokenOrCode.lang || 'text') : (langOrUndefined || 'text');
      const lang = String(rawLang).split(/\s+/)[0].replace(/[^A-Za-z0-9_+#.-]/g, '') || 'text';
      const escapedCode = String(code).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return '<div class="code-container my-3" data-lang="' + lang + '"><pre><code class="language-' + lang + ' p-3 block overflow-x-auto text-sm">' + escapedCode + '</code></pre></div>';
    };
    marked.setOptions({ renderer: renderer });

    function decorateCodeBlocks(root) {
      root.querySelectorAll('.code-container').forEach(function(box) {
        if (box.dataset.decorated) return;
        const codeEl = box.querySelector('pre code');
        if (!codeEl) return;
        box.dataset.decorated = '1';
        const code = codeEl.textContent;
        const lang = box.getAttribute('data-lang') || 'text';

        const header = document.createElement('div'); header.className = 'code-header';
        const label = document.createElement('span'); label.className = 'uppercase tracking-wider font-semibold'; label.textContent = lang;
        const btns = document.createElement('div'); btns.className = 'flex items-center';
        function mk(text, cls, fn) {
          const b = document.createElement('button'); b.type = 'button';
          b.className = cls + ' transition flex items-center gap-1'; b.textContent = text; b.addEventListener('click', fn); return b;
        }
        if (lang.toLowerCase() === 'python' || lang.toLowerCase() === 'py') {
          btns.appendChild(mk('▶ Run Local', 'hover:text-emerald-600 dark:hover:text-emerald-400 font-bold text-emerald-700 dark:text-emerald-500 mr-3', function(ev) { runCodeWithConfirmation(ev.currentTarget, code, box); }));
        }
        btns.appendChild(mk('💾 Save', 'hover:text-blue-600 dark:hover:text-blue-400 font-bold text-blue-700 dark:text-blue-500 mr-3', function() { window.pywebview.api.save_code_to_file(code); }));
        btns.appendChild(mk('📋 Copy', 'hover:text-black dark:hover:text-white', function(ev) {
          copyToClipboard(code); const b = ev.currentTarget; b.textContent = 'Copied!'; setTimeout(function() { b.textContent = '📋 Copy'; }, 2000);
        }));
        header.appendChild(label); header.appendChild(btns);
        box.insertBefore(header, box.firstChild);
        const out = document.createElement('div'); out.className = 'code-output hidden'; box.appendChild(out);
        if (typeof hljs !== 'undefined') { try { hljs.highlightElement(codeEl); } catch (e) {} }
      });
    }

    function sanitizeHTML(html) {
      if (typeof DOMPurify !== 'undefined') {
        return DOMPurify.sanitize(html, {
          FORBID_TAGS: ['button', 'form', 'input', 'textarea', 'select', 'style', 'iframe', 'object', 'embed', 'link', 'meta'],
          FORBID_ATTR: ['data-action', 'data-payload', 'style']
        });
      }
      return esc(html);   // if the sanitizer library failed to load, show plain text instead of risky HTML
    }

    function renderMarkdownInto(el, text) {
      let html;
      try { html = (typeof marked !== 'undefined') ? marked.parse(text || '') : esc(text); } catch (e) { html = esc(text); }
      el.innerHTML = sanitizeHTML(html);
      decorateCodeBlocks(el);
    }

    window.addEventListener("dragover", function(e) { e.preventDefault(); document.body.classList.add("drag-active"); });
    window.addEventListener("dragleave", function(e) { e.preventDefault(); if (!e.relatedTarget) document.body.classList.remove("drag-active"); });
    window.addEventListener("dragend", function() { document.body.classList.remove("drag-active"); });
    window.addEventListener("drop", function(e) { e.preventDefault(); document.body.classList.remove("drag-active"); if (e.dataTransfer.files.length > 0) processFileObjects(e.dataTransfer.files); });
    window.addEventListener("paste", function(e) { if (e.clipboardData.files.length > 0) processFileObjects(e.clipboardData.files); });
    function handleFileSelect(e) { if (e.target.files.length > 0) processFileObjects(e.target.files); e.target.value = ''; }

    async function processFileObjects(files) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]; const reader = new FileReader();
        reader.onload = function(e) { attachedFiles.push({ name: file.name, data: e.target.result }); renderAttachments(); };
        reader.readAsDataURL(file);
      }
    }

    function renderAttachments() {
      const container = document.getElementById('attachment-container'); container.innerHTML = "";
      attachedFiles.forEach(function(file, index) {
        const badge = document.createElement('div'); badge.className = "flex items-center gap-2 bg-zinc-200 dark:bg-[#3f3f46] text-xs px-3 py-1 rounded-md text-black dark:text-zinc-200 shadow-sm border border-zinc-300 dark:border-transparent";
        badge.innerHTML = "<span class=\"truncate max-w-[150px]\">&#x1F4CE; " + esc(file.name) + "</span><button onclick=\"removeAttachment(" + index + ")\" class=\"hover:text-red-500 dark:hover:text-red-400 font-bold\">✕</button>"; 
        container.appendChild(badge);
      });
    }

    function removeAttachment(index) { attachedFiles.splice(index, 1); renderAttachments(); }

    async function switchBranch(msgId, direction) {
        if (isGenerating) return;
        await window.pywebview.api.switch_branch(activeChatId, msgId, direction);
        fullChatCache = await window.pywebview.api.get_history();
        if (fullChatCache[activeChatId] && fullChatCache[activeChatId].length) await renderChat(fullChatCache[activeChatId], activeChatId);
    }

    function generateActionBar(msg) {
      const enc = encAttr(typeof msg.content === 'string' ? msg.content : (msg.display_text || '')); const est = estimateTokens(msg.content);
      const tokenLabel = (msg.usage && msg.usage.completion != null) ? ((msg.usage.prompt != null ? 'in ' + msg.usage.prompt + ' · ' : '') + 'out ' + msg.usage.completion + ' tokens') : ('~' + est + ' tokens');
      const saveImgBtn = msg.image ? "<button onclick=\"saveMessageImage('" + sid(msg.id) + "')\" class=\"hover:text-black dark:hover:text-white transition text-xs flex items-center gap-1 bg-zinc-50 dark:bg-[#202022] px-2 py-1 rounded shadow-sm border border-zinc-200 dark:border-transparent\">💾 Save image</button>" : "";
      let branchUI = "";
      if (msg.branch_count > 1) {
          branchUI = "<div class=\"flex items-center gap-2 bg-zinc-100 dark:bg-[#1f1f23] rounded-full px-2 py-0.5 text-[10px] text-zinc-500 dark:text-zinc-400 font-mono border border-zinc-200 dark:border-[#3f3f46]\">" +
              "<button onclick=\"switchBranch('" + sid(msg.id) + "', -1)\" class=\"hover:text-black dark:hover:text-white px-1\">&lt;</button>" +
              "<span>" + msg.branch_index + "/" + msg.branch_count + "</span>" +
              "<button onclick=\"switchBranch('" + sid(msg.id) + "', 1)\" class=\"hover:text-black dark:hover:text-white px-1\">&gt;</button></div>";
      }
      return "<div class=\"flex items-center justify-between mt-3 pt-3 text-zinc-500 dark:text-zinc-400 border-t border-zinc-200 dark:border-[#3f3f46]/30\">" +
        "<div class=\"flex items-center gap-2\">" + branchUI +
        "<button onclick=\"regenerateMessage('" + sid(msg.id) + "')\" class=\"hover:text-black dark:hover:text-white transition text-xs flex items-center gap-1 bg-zinc-50 dark:bg-[#202022] px-2 py-1 rounded shadow-sm border border-zinc-200 dark:border-transparent\">↻ Regenerate</button>" +
        "<button data-action=\"copy-text\" data-payload=\"" + enc + "\" class=\"hover:text-black dark:hover:text-white transition text-xs flex items-center gap-1 bg-zinc-50 dark:bg-[#202022] px-2 py-1 rounded shadow-sm border border-zinc-200 dark:border-transparent\">📋 Copy</button>" +
        "<button data-action=\"listen-text\" data-payload=\"" + enc + "\" class=\"hover:text-black dark:hover:text-white transition text-xs flex items-center gap-1 bg-zinc-50 dark:bg-[#202022] px-2 py-1 rounded shadow-sm border border-zinc-200 dark:border-transparent\">🔊 Listen</button>" + saveImgBtn + "<button onclick=\"openExportMenu('" + sid(msg.id) + "')\" class=\"hover:text-black dark:hover:text-white transition text-xs flex items-center gap-1 bg-zinc-50 dark:bg-[#202022] px-2 py-1 rounded shadow-sm border border-zinc-200 dark:border-transparent\">📄 Export</button>" +
        "</div><span class=\"text-[10px] text-zinc-400 dark:text-zinc-500 font-mono truncate max-w-[55%]\" title=\"" + (msg.usage ? "Exact numbers reported by your provider" : "Rough estimate") + "\">" + (msg.model ? esc(msg.model) + " · " : "") + tokenLabel + "</span></div>";
    }

    function generateUserActionBar(msg) {
      if (!msg.id) return "";   // message not saved yet: no Edit button until the chat is reloaded
      const enc = encAttr(msg.display_text || (typeof msg.content === 'string' ? msg.content : ''));
      let branchUI = "";
      if (msg.branch_count > 1) {
          branchUI = "<div class=\"flex items-center gap-2 bg-white dark:bg-[#1f1f23] rounded-full px-2 py-0.5 text-[10px] text-zinc-500 dark:text-zinc-400 font-mono border border-zinc-200 dark:border-[#3f3f46] mr-2\">" +
              "<button onclick=\"switchBranch('" + sid(msg.id) + "', -1)\" class=\"hover:text-black dark:hover:text-white px-1\">&lt;</button>" +
              "<span>" + msg.branch_index + "/" + msg.branch_count + "</span>" +
              "<button onclick=\"switchBranch('" + sid(msg.id) + "', 1)\" class=\"hover:text-black dark:hover:text-white px-1\">&gt;</button></div>";
      }
      return "<div class=\"absolute right-1 -bottom-7 flex items-center gap-3 text-zinc-500 opacity-0 group-hover:opacity-100 transition justify-end\">" + branchUI +
        "<button onclick=\"editMessageDirect(decodeURIComponent('" + enc + "'), '" + sid(msg.id) + "')\" class=\"hover:text-black dark:hover:text-white transition text-xs flex items-center gap-1\">✏️ Edit</button>" +
        "<button data-action=\"copy-text\" data-payload=\"" + enc + "\" class=\"hover:text-black dark:hover:text-white transition text-xs flex items-center gap-1\">📋 Copy</button></div>";
    }

    function startPolling() {
        if (streamInterval) clearInterval(streamInterval);
        streamInterval = setInterval(async function() {
            try {
                let res = await window.pywebview.api.poll_stream();
                if (res.chunk) receiveTokenRaw(res.chunk);
                if (res.error) receiveTokenRaw(res.error);
                if (res.done) {
                    clearInterval(streamInterval);
                    streamInterval = null;
                    finalizeStream();
                }
            } catch (e) { console.error("Poll Error:", e); }
        }, 150);
    }

    function receiveTokenRaw(chunk) {
      showChatView();
      const thinking = document.getElementById('thinking-indicator'); if (thinking) thinking.remove();
      rawStreamBuffer += chunk;
      if (currentStreamElement) {
        currentStreamElement.classList.remove('hidden'); 
        if (!tokenParseTimeout) {
            tokenParseTimeout = setTimeout(function() {
                try {
                    renderMarkdownInto(currentStreamElement, rawStreamBuffer);
                } catch (e) {
                    currentStreamElement.innerText = rawStreamBuffer;
                }
                if(!userScrolledUp) chatBox.scrollTop = chatBox.scrollHeight;
                tokenParseTimeout = null;
            }, 50);
        }
      }
    }

    async function regenerateMessage(msgId) {
      if (isGenerating) return;
      await window.pywebview.api.rewind_chat(activeChatId, msgId);
      fullChatCache = await window.pywebview.api.get_history();
      setGenerationState(true); userScrolledUp = false;
      await renderChat(fullChatCache[activeChatId] || [], activeChatId, true);   // redraw without the old reply
      const wrapper = document.createElement('div'); wrapper.className = "flex justify-start w-full mb-2";
      wrapper.innerHTML = "<div class=\"bg-transparent rounded-2xl py-2 w-full max-w-3xl\"><div id=\"thinking-indicator\" class=\"text-zinc-400 text-sm flex items-center gap-2 mb-2 animate-pulse\">🌀 Thinking...</div><div class=\"prose prose-invert text-sm max-w-none text-black dark:text-zinc-200 break-words hidden\" id=\"stream-target\"></div><div id=\"stream-actions\"></div></div>";
      document.getElementById('chat-messages').appendChild(wrapper); currentStreamElement = wrapper.querySelector('#stream-target'); rawStreamBuffer = "";
      chatBox.scrollTop = chatBox.scrollHeight;

      const params = { temperature: numOr(document.getElementById('param-temp').value, 0.7), context_limit: parseInt(document.getElementById('param-ctx').value) || 10, system_prompt: document.getElementById('param-system').value.trim(), is_image_mode: isImageMode, regenerate: true, active_workspace: activeWorkspace, web_search: isWebSearchActive, pdf_images: document.getElementById('param-pdfimg').checked };
      try {
          await window.pywebview.api.send_prompt_stream(null, null, params);
          startPolling();
      } catch (err) { finalizeStream(); }
    }

    async function editMessageDirect(text, msgId) {
      if (isGenerating || !msgId) return;
      await window.pywebview.api.rewind_chat(activeChatId, msgId);
      fullChatCache = await window.pywebview.api.get_history();
      const msgs = fullChatCache[activeChatId] || [];
      if (msgs.length) { await renderChat(msgs, activeChatId); }
      else { document.getElementById('chat-messages').innerHTML = ""; showEmptyState(); loadHistory(); }
      const input = document.getElementById('prompt-input');
      input.value = text; handleInputTelemetry(input); input.focus();
    }

    window.addEventListener('pywebviewready', async function() {
      globalConfig = await window.pywebview.api.get_config();
      refreshActiveModelDisplay(); populateModelList(currentModels); loadHistory();
      refreshModels();   // ask the provider which models it really offers
      checkVersions();
    });

    function refreshActiveModelDisplay() {
      if (!globalConfig) return;
      const activeId = globalConfig.active_profile_id || "default"; 
      const profile = (globalConfig.profiles && globalConfig.profiles[activeId]) || {};
      const model = profile.model_name || globalConfig.model_name || 'Select Model';
      document.getElementById('active-model-display').innerText = model + " ▾";
    }

    function populateModelList(models) {
      const list = document.getElementById('model-list'); list.innerHTML = "";
      const activeId = globalConfig.active_profile_id || "default";
      const profile = (globalConfig.profiles && globalConfig.profiles[activeId]) ? globalConfig.profiles[activeId] : {};
      const baseUrl = profile.base_url || globalConfig.base_url || "";
      const isLocal = baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");

      if (isLocal && !modelsLive) {
         const infoItem = document.createElement('div'); infoItem.className = "p-3 flex flex-col text-center text-zinc-500 text-xs bg-zinc-100 dark:bg-[#1f1f23] rounded";
         infoItem.innerHTML = "<span><b>Local Server</b></span><span class='mt-1 opacity-80'>Could not read its model list (is the server running?). Type your local model ID above.</span>";
         list.appendChild(infoItem); return;
      }

      const MAX_SHOWN = 300;
      models.slice(0, MAX_SHOWN).forEach(function(m) {
        const item = document.createElement('div'); item.className = "p-2 hover:bg-zinc-100 dark:hover:bg-[#2d2d2f] cursor-pointer rounded flex flex-col transition";
        item.innerHTML = "<span class=\"font-semibold text-black dark:text-zinc-200\">" + esc(m.name) + "</span><span class=\"text-[10px] text-zinc-500 font-mono\">" + esc(m.id) + "</span>";
        item.onclick = async function() {
          const activeId = globalConfig.active_profile_id || "default";
          if (!globalConfig.profiles) globalConfig.profiles = {}; if (!globalConfig.profiles[activeId]) globalConfig.profiles[activeId] = {};
          globalConfig.profiles[activeId].model_name = m.id; globalConfig.model_name = m.id;
          await window.pywebview.api.save_config(globalConfig); refreshActiveModelDisplay(); toggleModelDropdown();
        };
        list.appendChild(item);
      });
      if (models.length > MAX_SHOWN) {
        const more = document.createElement('div'); more.className = "p-2 text-center text-[11px] text-zinc-500";
        more.innerText = "Showing the first " + MAX_SHOWN + " of " + models.length + " models. Type above to search.";
        list.appendChild(more);
      }
    }

    // Asks the provider for its real model list; falls back to the built-in list if that fails.
    async function refreshModels() {
      try {
        const r = await window.pywebview.api.list_models();
        if (r && r.ok && r.models && r.models.length) { currentModels = r.models; modelsLive = true; }
        else { currentModels = KNOWN_MODELS.slice(); modelsLive = false; }
      } catch (e) { currentModels = KNOWN_MODELS.slice(); modelsLive = false; }
      if (globalConfig) filterModels(document.getElementById('model-search').value || '');
    }

    function toggleModelDropdown() {
      const dd = document.getElementById('model-dropdown');
      dd.classList.toggle('hidden');
      if (!dd.classList.contains('hidden')) refreshModels();
    }

    function filterModels(val) {
      const q = (val || '').toLowerCase();
      const filtered = currentModels.filter(function(m) { return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q); });
      populateModelList(filtered);
      if (val.trim().length > 0 && !filtered.some(function(m) { return m.id === val.trim(); })) {
        const list = document.getElementById('model-list'); const customItem = document.createElement('div');
        customItem.className = "p-2 hover:bg-blue-100 dark:hover:bg-blue-600/30 cursor-pointer rounded flex flex-col transition border-t border-zinc-200 dark:border-[#3f3f46]";
        customItem.innerHTML = "<span class=\"font-semibold text-blue-600 dark:text-blue-400\">Use custom: " + esc(val.trim()) + "</span>";
        customItem.onclick = async function() {
          const activeId = globalConfig.active_profile_id || "default";
          if (!globalConfig.profiles) globalConfig.profiles = {}; if (!globalConfig.profiles[activeId]) globalConfig.profiles[activeId] = {};
          globalConfig.profiles[activeId].model_name = val.trim(); globalConfig.model_name = val.trim();
          await window.pywebview.api.save_config(globalConfig); refreshActiveModelDisplay(); toggleModelDropdown();
        };
        list.prepend(customItem);
      }
    }

    function toggleSearch() { const sc = document.getElementById('search-container'); sc.classList.toggle('hidden'); if (!sc.classList.contains('hidden')) document.getElementById('chat-search').focus(); }
    function filterHistory(term) { renderHistoryItems(fullChatCache, metadataCache, term.toLowerCase()); }

    async function loadHistory() { 
      fullChatCache = await window.pywebview.api.get_history(); metadataCache = await window.pywebview.api.get_metadata(); renderHistoryItems(fullChatCache, metadataCache, ""); 
    }

    function renderHistoryItems(history, meta, filter) {
      const normalList = document.getElementById('history-list'); const pinnedList = document.getElementById('pinned-list'); const pinnedSection = document.getElementById('pinned-section');
      normalList.innerHTML = ""; pinnedList.innerHTML = ""; let hasChats = false, hasPinned = false; const safeMeta = meta || {};

      const entries = Object.entries(history || {}).sort(function(a, b) { return b[0].localeCompare(a[0]); });   // newest chat first
      for (const [id, messages] of entries) {
        if (!messages || !messages.length) continue; const title = messages[0].title || "Conversation";
        let matchesFilter = true;
        if (filter) { matchesFilter = title.toLowerCase().includes(filter) || messages.some(function(m) { return (m.content && typeof m.content === 'string' && m.content.toLowerCase().includes(filter)) || (m.display_text && m.display_text.toLowerCase().includes(filter)); }); }
        if (!matchesFilter) continue;
        hasChats = true; const isPinned = safeMeta[id] && safeMeta[id].pinned; if (isPinned) hasPinned = true; const isActive = (id === activeChatId); 
        const row = document.createElement('div');
        row.className = "flex items-center justify-between group rounded-lg px-2.5 py-1.5 cursor-pointer transition text-xs " + (isActive ? "bg-zinc-200 dark:bg-[#2d2d2f] border-l-2 border-blue-500" : "hover:bg-zinc-200 dark:hover:bg-[#2d2d2f]");
        row.onclick = function() { renderChat(messages, id); };
        row.ondblclick = function(ev) { startRename(ev, id); };
        row.innerHTML = "<div class=\"flex items-center gap-2 truncate\"><span class=\"text-zinc-500\">" + (messages[0].is_image_mode ? '🎨' : '💬') + "</span><span data-title-for=\"" + esc(id) + "\" class=\"text-zinc-600 dark:text-zinc-300 group-hover:text-black dark:group-hover:text-white truncate " + (isActive ? 'font-bold text-black dark:text-white' : '') + "\">" + esc(title) + "</span></div>" +
          "<div class=\"flex items-center gap-1 opacity-0 group-hover:opacity-100 transition\"><button title=\"" + (isPinned ? 'Unpin' : 'Pin') + "\" onclick=\"togglePin(event, '" + sid(id) + "')\" class=\"text-zinc-500 hover:text-amber-500 dark:hover:text-amber-400 p-0.5\">" + (isPinned ? '★' : '☆') + "</button><button title=\"Rename\" onclick=\"startRename(event, '" + sid(id) + "')\" class=\"text-zinc-500 hover:text-blue-500 p-0.5\">✏️</button><button title=\"Delete\" onclick=\"deleteChat(event, '" + sid(id) + "')\" class=\"text-zinc-500 hover:text-red-500 p-0.5\">✕</button></div>";
        if (isPinned) pinnedList.appendChild(row); else normalList.appendChild(row);
      }
      pinnedSection.classList.toggle('hidden', !hasPinned); 
      const activeMsgs = activeChatId ? (history[activeChatId] || []) : [];
      if (activeMsgs.length > 0) { showChatView(); } else { showEmptyState(); }
    }

    // Rename a chat right in the sidebar (double-click the name, or press the pencil).
    function startRename(e, id) {
      e.stopPropagation();
      const span = document.querySelector('[data-title-for="' + id + '"]');
      if (!span) return;
      const old = span.innerText;
      const input = document.createElement('input');
      input.type = 'text'; input.value = old; input.maxLength = 80;
      input.className = 'w-full bg-white dark:bg-[#2a2a2c] text-xs text-black dark:text-white px-1 py-0.5 rounded border border-blue-500 focus:outline-none';
      input.onclick = function(ev) { ev.stopPropagation(); };
      input.ondblclick = function(ev) { ev.stopPropagation(); };
      let finished = false;
      async function commit(save) {
        if (finished) return; finished = true;
        const value = input.value.trim();
        if (save && value && value !== old) {
          await window.pywebview.api.rename_chat(id, value);
          if (id === activeChatId) document.getElementById('active-chat-title').innerText = value;
        }
        loadHistory();
      }
      input.onkeydown = function(ev) { ev.stopPropagation(); if (ev.key === 'Enter') commit(true); else if (ev.key === 'Escape') commit(false); };
      input.onblur = function() { commit(true); };
      span.replaceWith(input); input.focus(); input.select();
    }

    async function togglePin(e, id) { e.stopPropagation(); await window.pywebview.api.toggle_pin_chat(id); loadHistory(); }
    async function clearAllChats() { if (isGenerating) return; if (confirm("Delete all chat conversations permanently?")) { await window.pywebview.api.clear_all_chats(); newChat(); } }
    async function deleteChat(e, id) { e.stopPropagation(); if (isGenerating) return; if (!confirm("Delete this chat permanently?")) return; await window.pywebview.api.delete_chat(id); if (activeChatId === id) newChat(); else loadHistory(); }

    async function renderChat(messages, id, force) {
      if (isGenerating && !force) return;
      messages = messages || [];
      activeChatId = id; window.pywebview.api.set_current_chat(id);
      document.getElementById('active-chat-title').innerText = (messages[0] && messages[0].title) || "Conversation";
      isImageMode = !!(messages[0] && messages[0].is_image_mode);   // an image chat stays an image chat, a text chat stays text
      const settings = (await window.pywebview.api.get_chat_settings(id)) || {};
      const temp = (settings.temperature !== undefined && settings.temperature !== null) ? settings.temperature : 0.7;
      const ctx = settings.context_limit || 10;
      document.getElementById('param-system').value = settings.system_prompt || ""; document.getElementById('param-ctx').value = ctx; document.getElementById('val-ctx').innerText = ctx; document.getElementById('param-temp').value = temp; document.getElementById('val-temp').innerText = temp; document.getElementById('param-pdfimg').checked = !!settings.pdf_images;
      const draft = localStorage.getItem("draft_" + id); const input = document.getElementById('prompt-input'); input.value = draft ? draft : ""; handleInputTelemetry(input);
      input.placeholder = isImageMode ? "Describe the image you want to generate..." : DEFAULT_PLACEHOLDER;
      const container = document.getElementById('chat-messages'); container.innerHTML = "";
      messages.forEach(function(msg) { if (msg.role !== 'system') appendStaticMessage(msg); }); loadHistory();
    }

    // If index.html and app-2.py come from different updates, say so clearly instead of silently missing features.
    async function checkVersions() {
      try {
        const appVersion = await window.pywebview.api.get_version();
        window.__appVersion = appVersion;
        if (appVersion !== PAGE_VERSION) {
          alert("Version mismatch!\n\nindex.html is version " + PAGE_VERSION + " but app-2.py is version " + appVersion + ".\n\nCopy BOTH new files into your project folder (replace the old ones), and rebuild the .exe if you use it.");
        }
      } catch (e) {}
    }

    // ---- export a reply as a real file ----
    let exportMsgId = null;
    function openExportMenu(msgId) { exportMsgId = msgId; document.getElementById('export-modal').classList.remove('hidden'); }
    function closeExportMenu() { document.getElementById('export-modal').classList.add('hidden'); }
    async function doExport(fmt) {
      const msgs = fullChatCache[activeChatId] || [];
      const msg = msgs.find(function(m) { return m.id === exportMsgId; });
      closeExportMenu();
      if (!msg) { showToast("Could not find that reply."); return; }
      let text = msg.display_text || (typeof msg.content === 'string' ? msg.content : '');
      text = text.replace(/^(?:>\s*(?:📂|🌐|⚠️|ℹ️)[^\n]*\n+)+/u, '');
      let html = '';
      try { html = sanitizeHTML((typeof marked !== 'undefined') ? marked.parse(text) : esc(text)); } catch (e) { html = esc(text); }
      try { await window.pywebview.api.export_message(activeChatId, exportMsgId, fmt, html); } catch (e) { showToast("Export failed."); }
    }

    // ---- open a file you sent earlier ----
    async function openAttachment(msgId, index) {
      try { await window.pywebview.api.open_attachment(activeChatId, msgId, index); } catch (e) { showToast("Could not open the file."); }
    }

    function saveMessageImage(msgId) { window.pywebview.api.save_message_image(activeChatId, msgId); }

    // "Files used" chips for answers that came from your attached folder. Click a chip to see the exact text that was used.
    function renderWorkspaceSources(sources) {
      if (!sources || sources.length === 0) return null;
      const wrapper = document.createElement('div'); wrapper.className = "mt-3 pt-2 border-t border-zinc-300 dark:border-[#3f3f46]/30";
      const header = document.createElement('div'); header.className = "text-[10px] uppercase font-bold tracking-wider text-zinc-500 mb-1.5"; header.innerText = "📂 Workspace files used (click to see the text)";
      const list = document.createElement('div'); list.className = "flex flex-wrap gap-2";
      const preview = document.createElement('pre'); preview.className = "hidden mt-2 p-2 text-[11px] whitespace-pre-wrap break-words bg-zinc-100 dark:bg-[#1f1f23] border border-zinc-200 dark:border-[#3f3f46] rounded max-h-48 overflow-y-auto text-zinc-700 dark:text-zinc-300";
      let openBtn = null;
      sources.forEach(function(s) {
        const btn = document.createElement('button'); btn.type = 'button';
        btn.className = "flex items-center gap-1.5 bg-zinc-100 dark:bg-[#1f1f23] hover:bg-zinc-200 dark:hover:bg-[#2d2d31] border border-zinc-200 dark:border-[#3f3f46] text-zinc-700 dark:text-zinc-300 px-2.5 py-1 rounded-full text-xs transition max-w-[260px]";
        const label = document.createElement('span'); label.className = "truncate font-mono text-[11px]"; label.innerText = "📄 " + (s.file || "file") + (s.chunks > 1 ? "  ×" + s.chunks : "");
        btn.appendChild(label);
        btn.onclick = function() {
          if (openBtn === btn && !preview.classList.contains('hidden')) { preview.classList.add('hidden'); openBtn = null; return; }
          preview.innerText = (s.file || "") + "\n\n" + (s.snippet || ""); preview.classList.remove('hidden'); openBtn = btn;
        };
        list.appendChild(btn);
      });
      wrapper.appendChild(header); wrapper.appendChild(list); wrapper.appendChild(preview); return wrapper;
    }

    function renderSourceChips(sources) {
      if (!sources || sources.length === 0) return null;
      const wrapper = document.createElement('div'); wrapper.className = "mt-3 pt-2 border-t border-zinc-300 dark:border-[#3f3f46]/30";
      const header = document.createElement('div'); header.className = "text-[10px] uppercase font-bold tracking-wider text-zinc-500 mb-1.5 flex items-center gap-1"; header.innerHTML = "<span>🌐 Sources Consulted</span>"; wrapper.appendChild(header);
      const list = document.createElement('div'); list.className = "flex flex-wrap gap-2";
      sources.forEach(function(s) {
        if (!s.url || (!s.url.startsWith("http://") && !s.url.startsWith("https://"))) return; let hostname = "web"; try { hostname = new URL(s.url).hostname.replace("www.", ""); } catch (e) {}
        const btn = document.createElement('button'); btn.setAttribute('data-action', 'open-url'); btn.setAttribute('data-payload', encodeURIComponent(s.url));
        btn.className = "flex items-center gap-1.5 bg-zinc-100 dark:bg-[#1f1f23] hover:bg-zinc-200 dark:hover:bg-[#2d2d31] border border-zinc-200 dark:border-[#3f3f46] text-zinc-700 dark:text-zinc-300 hover:text-black dark:hover:text-white px-2.5 py-1 rounded-full text-xs transition duration-150 max-w-[220px]";
        const icon = document.createElement('span'); icon.className = "text-blue-500 dark:text-blue-400 text-[11px]"; icon.innerText = "🔗";
        const host = document.createElement('span'); host.className = "font-medium text-[11px] text-zinc-500 dark:text-zinc-400 font-mono"; host.innerText = hostname;
        const title = document.createElement('span'); title.className = "truncate text-[11px]"; title.innerText = s.title || hostname;
        btn.appendChild(icon); btn.appendChild(host); btn.appendChild(title); list.appendChild(btn);
      });
      wrapper.appendChild(list); return wrapper;
    }

    function appendStaticMessage(msg) {
      showChatView();
      const container = document.getElementById('chat-messages'); const isUser = msg.role === 'user';
      let images = []; if (msg.image) images.push(msg.image);
      if (Array.isArray(msg.content)) { msg.content.forEach(function(item) { if (item && item.type === 'image_url' && item.image_url && item.image_url.url) { if (!images.includes(item.image_url.url)) images.push(item.image_url.url); } }); }
      
      let imgHtml = ""; if (images.length > 0) { imgHtml = "<div class=\"flex flex-wrap gap-2 mb-2\">" + images.map(function(src) { return "<img src=\"" + esc(src) + "\" class=\"max-w-sm rounded-lg border border-zinc-200 dark:border-[#3f3f46] shadow-sm\"/>"; }).join("") + "</div>"; }
      let filesHtml = ""; if (msg.files && Array.isArray(msg.files) && msg.files.length > 0) { filesHtml = "<div class=\"flex flex-wrap gap-1.5 mb-2\">" + msg.files.map(function(f, idx) { const name = (f && f.name) ? f.name : "Document"; const chipClass = "inline-flex items-center gap-1 bg-zinc-200 dark:bg-[#18181b] border border-zinc-300 dark:border-[#3f3f46] text-black dark:text-zinc-300 text-[11px] px-2.5 py-1 rounded-md shadow-sm font-mono"; if (msg.id) { return "<button type=\"button\" title=\"Click to open this file\" onclick=\"openAttachment('" + sid(msg.id) + "', " + idx + ")\" class=\"" + chipClass + " hover:bg-zinc-300 dark:hover:bg-[#2d2d31] cursor-pointer transition\">📄 " + esc(name) + "</button>"; } return "<span class=\"" + chipClass + "\">📄 " + esc(name) + "</span>"; }).join("") + "</div>"; }

      const messageText = msg.display_text || (typeof msg.content === 'string' ? msg.content : "");

      let contentHtml = imgHtml + filesHtml + "<div class=\"prose prose-invert text-sm max-w-none text-black dark:text-zinc-200 break-words\"></div>";
      const actionBar = isUser ? generateUserActionBar(msg) : generateActionBar(msg);
      const wrapper = document.createElement('div'); wrapper.className = "flex " + (isUser ? "justify-end mb-8" : "justify-start mb-2") + " w-full group";
      
      const inner = document.createElement('div');
      inner.className = isUser ? "relative bg-zinc-100 dark:bg-[#2d2d2f] border border-zinc-200 dark:border-[#3f3f46] rounded-2xl px-5 py-3 max-w-3xl flex flex-col items-end" : "bg-transparent rounded-2xl py-2 w-full max-w-3xl";
      inner.innerHTML = contentHtml;
      renderMarkdownInto(inner.querySelector('.prose'), messageText);

      if (!isUser && msg.workspace_sources && msg.workspace_sources.length) { const wsNodes = renderWorkspaceSources(msg.workspace_sources); if (wsNodes) inner.appendChild(wsNodes); }
      if (!isUser && msg.sources && msg.sources.length) { const sourceNodes = renderSourceChips(msg.sources); if (sourceNodes) inner.appendChild(sourceNodes); }
      const barNode = document.createElement('div'); barNode.innerHTML = actionBar; inner.appendChild(barNode);
      wrapper.appendChild(inner); container.appendChild(wrapper);

      wrapper.querySelectorAll('img').forEach(function(img) { img.addEventListener('load', function() { if (!userScrolledUp) container.scrollTop = container.scrollHeight; }); });
      if(!userScrolledUp) container.scrollTop = container.scrollHeight;
    }

    async function finalizeStream() {
      const thinking = document.getElementById('thinking-indicator'); if (thinking) thinking.remove();
      // Draw any text still waiting in the 50ms buffer before letting go of the element.
      if (tokenParseTimeout) { clearTimeout(tokenParseTimeout); tokenParseTimeout = null; }
      if (currentStreamElement) {
        try {
          renderMarkdownInto(currentStreamElement, rawStreamBuffer);
          currentStreamElement.classList.remove('hidden');
        } catch (e) {
          currentStreamElement.innerText = rawStreamBuffer;
        }
      }
      currentStreamElement = null; setGenerationState(false);
      if (streamInterval) { clearInterval(streamInterval); streamInterval = null; }
      try {
        fullChatCache = await window.pywebview.api.get_history();
        // Redraw the finished chat from saved data so every message gets its Regenerate / Copy / Edit / branch buttons.
        if (activeChatId && fullChatCache[activeChatId] && fullChatCache[activeChatId].length) await renderChat(fullChatCache[activeChatId], activeChatId);
        else loadHistory();
      } catch (e) { console.error(e); }
    }

    function setGenerationState(generating) {
      isGenerating = generating; const btn = document.getElementById('action-btn'); btn.innerHTML = isGenerating ? "■" : "↑"; 
      btn.className = isGenerating ? "bg-red-500 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-red-400 transition font-bold" : "bg-black dark:bg-white text-white dark:text-black rounded-full w-8 h-8 flex items-center justify-center hover:bg-zinc-800 dark:hover:bg-zinc-200 transition font-bold text-lg";
    }

    async function handleAction() {
      if (isGenerating) {
        await window.pywebview.api.stop_generation();   // the backend saves the partial reply, then the poller finishes up
        setTimeout(function() { if (isGenerating && streamInterval) { finalizeStream(); } }, 8000);   // safety net if the server never answers
        return;
      }
      const input = document.getElementById('prompt-input'); const text = input.value.trim(); if (!text && attachedFiles.length === 0) return;
      input.value = ''; input.style.height = ''; if (activeChatId) localStorage.removeItem("draft_" + activeChatId);
      setGenerationState(true); userScrolledUp = false; showChatView();

      if (!activeChatId) { activeChatId = await window.pywebview.api.start_new_chat(false); document.getElementById('active-chat-title').innerText = "New Conversation"; }

      const primaryImage = attachedFiles.find(function(f) { return f.data && f.data.startsWith("data:image"); })?.data || null;
      const docFiles = attachedFiles.filter(function(f) { return !(f.data && f.data.startsWith("data:image")); }).map(function(f) { return { name: f.name }; });
      const tempMsg = { role: 'user', content: text || "[" + attachedFiles.length + " File(s) Attached]", display_text: text || "[" + attachedFiles.length + " File(s) Attached]", image: primaryImage, files: docFiles, branch_count: 1 };
      appendStaticMessage(tempMsg);
      
      const payloadFiles = [...attachedFiles]; attachedFiles = []; renderAttachments();
      const container = document.getElementById('chat-messages'); const wrapper = document.createElement('div'); wrapper.className = "flex justify-start w-full mb-2";
      wrapper.innerHTML = "<div class=\"bg-transparent rounded-2xl py-2 w-full max-w-3xl\"><div id=\"thinking-indicator\" class=\"text-zinc-400 text-sm flex items-center gap-2 mb-2 animate-pulse\">🌀 Thinking...</div><div class=\"prose prose-invert text-sm max-w-none text-black dark:text-zinc-200 break-words hidden\" id=\"stream-target\"></div><div id=\"stream-actions\"></div></div>";
      container.appendChild(wrapper); currentStreamElement = wrapper.querySelector('#stream-target'); rawStreamBuffer = "";

      const params = { temperature: numOr(document.getElementById('param-temp').value, 0.7), context_limit: parseInt(document.getElementById('param-ctx').value) || 10, system_prompt: document.getElementById('param-system').value.trim(), is_image_mode: isImageMode, active_workspace: activeWorkspace, web_search: isWebSearchActive, pdf_images: document.getElementById('param-pdfimg').checked };
      try { 
          await window.pywebview.api.send_prompt_stream(text, payloadFiles, params);
          startPolling();
      } catch (err) { finalizeStream(); }
    }

    async function newChat() {
      if (isGenerating) return; isImageMode = false; activeChatId = await window.pywebview.api.start_new_chat(false);
      document.getElementById('active-chat-title').innerText = "New Conversation"; document.getElementById('param-system').value = ""; document.getElementById('param-ctx').value = 10; document.getElementById('val-ctx').innerText = 10; document.getElementById('param-temp').value = 0.7; document.getElementById('val-temp').innerText = 0.7; document.getElementById('param-pdfimg').checked = false;
      const input = document.getElementById('prompt-input'); input.value = ""; input.placeholder = DEFAULT_PLACEHOLDER; handleInputTelemetry(input);
      document.getElementById('chat-messages').innerHTML = ""; showEmptyState(); loadHistory();
    }

    async function startImageChat() {
      if (isGenerating) return; isImageMode = true; activeChatId = await window.pywebview.api.start_new_chat(true); document.getElementById('active-chat-title').innerText = "Image Studio"; 
      document.getElementById('prompt-input').placeholder = "Describe the image you want to generate..."; document.getElementById('chat-messages').innerHTML = ""; showEmptyState(); loadHistory();
    }

    async function cancelSettings() {
      try { globalConfig = await window.pywebview.api.get_config(); refreshActiveModelDisplay(); populateModelList(currentModels); } catch (e) {}
      document.getElementById('global-settings-modal').classList.add('hidden');
    }

    async function exportAllChats() { try { await window.pywebview.api.export_all_chats(); } catch (e) { showToast("Export failed."); } }
    async function importChats() {
      try { const n = await window.pywebview.api.import_chats(); if (n > 0) { await loadHistory(); } } catch (e) { showToast("Import failed."); }
    }

    function toggleChatSettings() { document.getElementById('chat-settings-modal').classList.toggle('hidden'); }
    
    async function toggleGlobalSettings() { 
      const modal = document.getElementById('global-settings-modal');
      if (modal.classList.contains('hidden')) {
        globalConfig = await window.pywebview.api.get_config(); populateProfileDropdown(); loadSelectedProfile();
        try { const info = await window.pywebview.api.key_storage_info(); document.getElementById('key-storage-note').innerText = info.text; } catch (e) {}
        document.getElementById('version-note').innerText = 'Version: page ' + PAGE_VERSION + ' / app ' + (window.__appVersion || '?');
      }
      modal.classList.toggle('hidden'); 
    }

    function populateProfileDropdown() {
      const select = document.getElementById('profile-select'); select.innerHTML = "";
      const profiles = (globalConfig && globalConfig.profiles) ? globalConfig.profiles : DEFAULT_PROFILES.profiles;
      for (const [key, profile] of Object.entries(profiles)) {
        const opt = document.createElement('option'); opt.value = key; opt.innerText = profile.name || key;
        if (key === (globalConfig.active_profile_id || "default")) opt.selected = true; select.appendChild(opt);
      }
    }

    function loadSelectedProfile() {
      const selectedKey = document.getElementById('profile-select').value; 
      const profile = (globalConfig && globalConfig.profiles && globalConfig.profiles[selectedKey]) ? globalConfig.profiles[selectedKey] : {};
      // Only this profile's own values are shown (never another profile's key).
      document.getElementById('cfg-name').value = profile.name || ""; document.getElementById('cfg-url').value = profile.base_url || "";
      document.getElementById('cfg-model').value = profile.model_name || ""; document.getElementById('cfg-img-model').value = profile.image_model || "dall-e-3";
      document.getElementById('cfg-headers').value = profile.custom_headers || ""; document.getElementById('cfg-key').value = profile.api_key || "";
    }

    function createNewProfile() {
      const newId = "profile_" + Date.now(); if (!globalConfig.profiles) globalConfig.profiles = {};
      globalConfig.profiles[newId] = { name: "New Profile", base_url: "", api_key: "", model_name: "", image_model: "dall-e-3", custom_headers: "" }; 
      globalConfig.active_profile_id = newId; populateProfileDropdown(); loadSelectedProfile();
    }

    function deleteSelectedProfile() {
      const activeId = document.getElementById('profile-select').value;
      if (activeId === 'default') { showToast("Cannot delete the default profile."); return; }
      if (confirm("Delete this provider profile?")) {
        delete globalConfig.profiles[activeId]; globalConfig.active_profile_id = 'default'; populateProfileDropdown(); loadSelectedProfile(); window.pywebview.api.save_config(globalConfig); showToast("Profile deleted.");
      }
    }

    async function saveSettings() {
      const activeId = document.getElementById('profile-select').value; globalConfig.active_profile_id = activeId; if (!globalConfig.profiles) globalConfig.profiles = {};
      const key = document.getElementById('cfg-key').value.trim(), url = document.getElementById('cfg-url').value.trim(), model = document.getElementById('cfg-model').value.trim(), imgModel = document.getElementById('cfg-img-model').value.trim() || "dall-e-3", headers = document.getElementById('cfg-headers').value.trim();
      globalConfig.profiles[activeId] = { name: document.getElementById('cfg-name').value.trim() || "Unnamed", base_url: url, model_name: model, image_model: imgModel, custom_headers: headers, api_key: key };
      globalConfig.api_key = key; globalConfig.base_url = url; globalConfig.model_name = model; globalConfig.image_model = imgModel; globalConfig.custom_headers = headers;
      await window.pywebview.api.save_config(globalConfig); refreshActiveModelDisplay();
      currentModels = KNOWN_MODELS.slice(); modelsLive = false; populateModelList(currentModels); refreshModels();   // new provider = new model list
      toggleGlobalSettings();
    }
  