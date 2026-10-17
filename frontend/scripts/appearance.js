/* Appearance and everyday controls preview. No changes to chat/generation code. */
(function () {
  'use strict';
  const palettes = {
    midnight: ['#111827','#0b1220','#1f2937','#334155','#f1f5f9','#cbd5e1',true],
    graphite: ['#202022','#1c1c1e','#2a2a2c','#52525b','#f4f4f5','#bcbcc4',true],
    ocean: ['#0c2230','#081a26','#153549','#386079','#ecf8ff','#bdd5e5',true],
    forest: ['#11261f','#0c1c17','#1e3a2e','#426354','#eefbf1','#c1d8c8',true],
    rose: ['#2c1b27','#21131d','#422b3b','#78506b','#fff1fa','#e3c6db',true],
    light: ['#ffffff','#f4f4f5','#e9e9ee','#b5b5c0','#18181b','#52525b',false],
    paper: ['#faf5e9','#eee7d8','#e6ddcb','#b5a58a','#32291e','#625340',false]
  };
  const defaults = {theme:'graphite',accent:'#3b82f6',font_size:14,chat_width:900};
  function normalize(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const number = (v,d,min,max) => Number.isFinite(Number(v)) ? Math.min(max,Math.max(min,Math.round(Number(v)))) : d;
    return {theme:Object.prototype.hasOwnProperty.call(palettes,raw.theme)?raw.theme:defaults.theme,
      accent:typeof raw.accent==='string' && /^#[0-9a-f]{6}$/i.test(raw.accent)?raw.accent:defaults.accent,
      font_size:number(raw.font_size,14,12,22),chat_width:number(raw.chat_width,900,650,1300)};
  }
  function foreground(hex) {
    const values = hex.slice(1).match(/../g).map(s=>parseInt(s,16)/255).map(v=>v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4));
    const l = values[0]*0.2126+values[1]*0.7152+values[2]*0.0722;
    return (l+0.05)/0.05 > 1.05/(l+0.05) ? '#000000' : '#ffffff';
  }
  if(typeof module!=='undefined' && module.exports) module.exports={normalize,foreground,palettes};
  if(typeof document==='undefined') return;
  function init() {
    if(document.getElementById('aspro-preferences')) return;
    let prefs=normalize({}), dirty=false, saves=Promise.resolve(), ready=false, saveTimer=null;
    try {prefs=normalize(JSON.parse(localStorage.getItem('aspro_appearance')||'{}'));} catch(e){}
    const root=document.documentElement;
    function apply() {
      const p=palettes[prefs.theme]; root.dataset.asproTheme=prefs.theme;
      ['--ui-bg','--ui-sidebar','--ui-surface','--ui-border','--ui-text','--ui-muted'].forEach((k,i)=>root.style.setProperty(k,p[i]));
      root.style.setProperty('--ui-accent',prefs.accent);root.style.setProperty('--ui-accent-text',foreground(prefs.accent));
      root.style.setProperty('--ui-font',prefs.font_size+'px');root.style.setProperty('--ui-width',prefs.chat_width+'px');
      root.classList.toggle('dark',p[6]);
      const icon=document.getElementById('theme-icon');if(icon)icon.textContent=p[6]?'☀️':'🌙';
      try {localStorage.setItem('aspro_appearance',JSON.stringify(prefs));localStorage.setItem('theme',p[6]?'dark':'light');}catch(e){}
    }
    function notice(text){if(typeof showToast==='function')showToast(text);}
    function persistNow() {
      if(!ready)return;
      const snapshot=Object.assign({},prefs);
      if(typeof globalConfig!=='undefined' && globalConfig)globalConfig.ui_preferences=snapshot;
      saves=saves.catch(()=>{}).then(()=>window.pywebview.api.save_config({ui_preferences:snapshot})).then(ok=>{if(!ok)throw new Error('Save failed');}).catch(()=>notice('Could not save appearance to disk. Please try again.'));
    }
    function persist(){apply();clearTimeout(saveTimer);saveTimer=setTimeout(persistNow,250);}
    const dialog=document.createElement('dialog');dialog.id='aspro-preferences';dialog.className='aspro-panel';
    dialog.innerHTML='<form method="dialog"><header><h2>Appearance</h2><button aria-label="Close appearance">✕</button></header></form><label>Theme<select id="aspro-theme"></select></label><label>Accent color<input id="aspro-accent" type="color"></label><label>Chat text size <output id="aspro-font-value"></output><input id="aspro-font" type="range" min="12" max="22" step="1"></label><label>Conversation width <output id="aspro-width-value"></output><input id="aspro-width" type="range" min="650" max="1300" step="50"></label><p>Changes are applied immediately and saved automatically. Base app version stays 1.2.1 for this preview.</p><button type="button" id="aspro-reset">Reset appearance</button>';
    document.body.appendChild(dialog);dialog.addEventListener('close',()=>{if(saveTimer){clearTimeout(saveTimer);saveTimer=null;persistNow();}});
    const byId=id=>document.getElementById(id);
    Object.keys(palettes).forEach(name=>{const opt=document.createElement('option');opt.value=name;opt.textContent=name[0].toUpperCase()+name.slice(1);byId('aspro-theme').appendChild(opt);});
    function fill(){byId('aspro-theme').value=prefs.theme;byId('aspro-accent').value=prefs.accent;byId('aspro-font').value=prefs.font_size;byId('aspro-width').value=prefs.chat_width;byId('aspro-font-value').value=prefs.font_size+' px';byId('aspro-width-value').value=prefs.chat_width+' px';}
    [['aspro-theme','theme'],['aspro-accent','accent'],['aspro-font','font_size'],['aspro-width','chat_width']].forEach(([id,key])=>byId(id).addEventListener('input',()=>{dirty=true;prefs=normalize(Object.assign({},prefs,{[key]:byId(id).value}));fill();persist();}));
    byId('aspro-reset').addEventListener('click',()=>{dirty=true;prefs=normalize(defaults);fill();persist();});
    const help=document.createElement('dialog');help.id='aspro-shortcuts';help.className='aspro-panel';
    help.innerHTML='<form method="dialog"><header><h2>Keyboard shortcuts</h2><button aria-label="Close shortcuts">✕</button></header></form><dl><dt>Enter</dt><dd>Send (while generating: stop)</dd><dt>Shift + Enter</dt><dd>New line</dd><dt>Ctrl + N</dt><dd>New chat</dd><dt>Ctrl + K</dt><dd>Search chats</dd><dt>Up arrow in an empty composer</dt><dd>Edit your last message</dd><dt>Escape</dt><dd>Close a menu or dialog</dd><dt>Ctrl + C / X / V</dt><dd>Copy / cut / paste selected text</dd></dl><p>Right-click text for editing controls. Cut and paste are only available in editable fields.</p>';
    document.body.appendChild(help);
    function open(d){fill();if(!d.open)d.showModal();}
    const bar=document.querySelector('main > header > div:last-child');
    if(bar){[['Appearance',()=>open(dialog)],['? Shortcuts',()=>open(help)]].forEach(([text,fn])=>{const b=document.createElement('button');b.className='aspro-toolbar';b.type='button';b.textContent=text;b.addEventListener('click',fn);bar.prepend(b);});}
    window.toggleTheme=function(){dirty=true;prefs.theme=palettes[prefs.theme][6]?'light':'graphite';fill();persist();};
    apply();fill();
    let loading=false;
    async function load(){
      if(loading || ready || !window.pywebview || !window.pywebview.api)return;
      loading=true;
      try{const cfg=await window.pywebview.api.get_config();if(!dirty && cfg && cfg.ui_preferences)prefs=normalize(cfg.ui_preferences);ready=true;apply();fill();if(dirty)persist();}
      catch(e){loading=false;notice('Appearance is available, but disk settings could not be loaded.');}
    }
    window.addEventListener('pywebviewready',load);load();
    const chat=byId('chat-messages'),footer=document.querySelector('main > footer');
    const jump=document.createElement('button');jump.id='aspro-bottom';jump.type='button';jump.textContent='↓ Latest';jump.setAttribute('aria-label','Jump to latest message');jump.hidden=true;
    document.querySelector('main').appendChild(jump);
    function position(){if(footer){const h=footer.getBoundingClientRect().height;jump.style.bottom=(h+38)+'px';chat.style.paddingBottom=(h+75)+'px';}jump.hidden=chat.classList.contains('hidden') || chat.scrollHeight-chat.scrollTop-chat.clientHeight<100;}
    chat.addEventListener('scroll',position);window.addEventListener('resize',position);
    if(typeof ResizeObserver!=='undefined'){const ro=new ResizeObserver(position);ro.observe(chat);if(footer)ro.observe(footer);}
    const mo=new MutationObserver(position);mo.observe(chat,{childList:true,subtree:true});
    jump.addEventListener('click',()=>{if(typeof userScrolledUp!=='undefined')userScrolledUp=false;chat.scrollTop=chat.scrollHeight;position();});position();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
