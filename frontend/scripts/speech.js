/* Read-aloud controls; uses only voices exposed by the browser/Windows. */
(function(){
 'use strict';
 function normalize(raw){
  raw=raw && typeof raw==='object'?raw:{};
  const ids=raw.voices && typeof raw.voices==='object'?raw.voices:{};
  const voices={};for(const l of ['en','fr','ar'])voices[l]=typeof ids[l]==='string'?ids[l].slice(0,300):'';
  return {language:['auto','en','fr','ar'].includes(raw.language)?raw.language:'auto',rate:Number.isFinite(Number(raw.rate))?Math.min(2,Math.max(0.5,Number(raw.rate))):1,skipCode:raw.skipCode!==false,allowRemote:raw.allowRemote===true,voices};
 }
 function cleanText(text,skipCode=true){
  let t=String(text||'');
  if(skipCode)t=t.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g,' ');
  else t=t.replace(/^\s*(?:```|~~~)[^\n]*$/gm,'');
  return t.replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,' ')
   .replace(/<[^>]*>/g,' ').replace(/^\s*\|?\s*[-:]+(?:\s*\|\s*[-:]+)+\s*\|?\s*$/gm,' ')
   .replace(/[*#_`~>]/g,'').replace(/\p{Extended_Pictographic}|\uFE0F/gu,'').replace(/\|/g,', ')
   .replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
 }
 function guessLanguage(text){
  if((text.match(/[\u0600-\u06ff]/g)||[]).length>(text.match(/[a-z]/gi)||[]).length/2)return 'ar';
  if(/[àâçéèêëîïôùûüœ]/i.test(text)||(text.match(/\b(bonjour|vous|nous|les|des|une|avec|pour|dans|est)\b/gi)||[]).length>=2)return 'fr';
  return 'en';
 }
 function splitText(text,max=300){
  const out=[];let rest=text.trim();
  while(rest.length>max){let cut=-1;const head=rest.slice(0,max);for(const p of ['. ','! ','? ','؟ ','; ','\n'])cut=Math.max(cut,head.lastIndexOf(p));if(cut<max/3)cut=head.lastIndexOf(' ');if(cut<1)cut=max;else cut+=1;out.push(rest.slice(0,cut).trim());rest=rest.slice(cut).trim();}
  if(rest)out.push(rest);return out;
 }
 function chooseVoice(list,lang,prefs){
  const matches=list.filter(v=>String(v.lang||'').toLowerCase().split(/[-_]/)[0]===lang && (prefs.allowRemote||v.localService===true));
  return matches.find(v=>v.voiceURI===prefs.voices[lang])||matches.sort((a,b)=>score(b)-score(a))[0]||null;
  function score(v){return (/natural|neural/i.test(v.name)?4:0)+(v.localService?2:0)+(v.default?1:0);}
 }
 if(typeof module!=='undefined' && module.exports)module.exports={normalize,cleanText,guessLanguage,splitText,chooseVoice};
 if(typeof document==='undefined')return;
 function init(){
  if(document.getElementById('aspro-voice'))return;
  const synth=window.speechSynthesis, supported=!!(synth && typeof window.SpeechSynthesisUtterance==='function');
  let prefs=normalize({}),available=[],ready=false,dirty=false,timer=null,saves=Promise.resolve();
  let generation=0,current=null,chunks=[],index=0,paused=false,language='en',selected=null,playbackRate=1;
  const names={en:'English',fr:'French',ar:'Arabic'};
  const panel=document.createElement('dialog');panel.id='aspro-voice';panel.className='aspro-panel';
  panel.innerHTML='<form method="dialog"><header><h2>Voice & playback</h2><button aria-label="Close voice settings">✕</button></header></form><label>Reading language<select id="voice-language"><option value="auto">Automatic (best guess)</option><option value="en">English</option><option value="fr">French</option><option value="ar">Arabic</option></select></label><div id="voice-pickers"></div><label>Speed <output id="voice-rate-label"></output><input id="voice-rate" type="range" min="0.5" max="2" step="0.1"></label><label><input id="voice-skip" type="checkbox"> Skip fenced code blocks</label><label><input id="voice-remote" type="checkbox"> Allow system/browser voices that may use online services</label><p id="voice-availability"></p><button id="voice-test" type="button" class="aspro-toolbar">Test voice</button><p>This changes Listen, not Dictate. Missing languages need a voice installed in Windows. Sound quality depends on the voices your browser exposes. Changes apply to the next playback.</p>';
  document.body.appendChild(panel);
  const player=document.createElement('div');player.id='aspro-player';player.hidden=true;
  player.style.cssText='position:fixed;top:82px;right:12px;z-index:40;padding:8px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-sidebar);color:var(--ui-text);font:12px Segoe UI,Arial;max-width:360px';
  player.innerHTML='<span id="voice-status" aria-live="polite"></span> <button type="button" id="voice-pause" class="aspro-toolbar">Pause</button> <button type="button" id="voice-stop" class="aspro-toolbar">Stop</button>';
  document.body.appendChild(player);
  const el=id=>document.getElementById(id),notice=t=>{if(typeof showToast==='function')showToast(t);};
  const open=document.createElement('button');open.type='button';open.className='aspro-toolbar';open.textContent='Voice & playback';open.style.cssText='width:100%;margin-top:6px';
  const slot=document.querySelector('aside > div:last-child');if(slot)slot.appendChild(open);
  open.onclick=()=>{refresh();if(!panel.open)panel.showModal();};
  function fill(){el('voice-language').value=prefs.language;el('voice-rate').value=prefs.rate;el('voice-rate-label').value=prefs.rate+'×';el('voice-skip').checked=prefs.skipCode;el('voice-remote').checked=prefs.allowRemote;}
  function refresh(){
   available=supported?synth.getVoices():[];el('voice-pickers').replaceChildren();
   for(const l of ['en','fr','ar']){
    const label=document.createElement('label');label.textContent=names[l]+' voice';const select=document.createElement('select');select.id='voice-'+l;
    const auto=document.createElement('option');auto.value='';auto.textContent='Automatic matching voice';select.appendChild(auto);
    const list=available.filter(v=>String(v.lang||'').toLowerCase().split(/[-_]/)[0]===l && (prefs.allowRemote||v.localService===true));
    for(const v of list){const o=document.createElement('option');o.value=v.voiceURI;o.textContent=v.name+' ('+v.lang+(v.localService?', local':', may use online service')+')';select.appendChild(o);}
    if(prefs.voices[l] && !list.some(v=>v.voiceURI===prefs.voices[l])){const o=document.createElement('option');o.value=prefs.voices[l];o.textContent='Saved voice currently unavailable';o.disabled=true;select.appendChild(o);}
    select.value=prefs.voices[l];select.onchange=()=>{prefs.voices[l]=select.value;save();};label.appendChild(select);el('voice-pickers').appendChild(label);
   }
   el('voice-availability').textContent=supported?available.filter(v=>prefs.allowRemote||v.localService===true).length+' eligible voice(s). If automatic language detection is wrong, select a language above.':'Read-aloud is not available in this browser. No audio service has been added.';
   el('voice-test').disabled=!supported;fill();
  }
  function persist(){if(!ready)return;const snapshot=normalize(prefs);if(typeof globalConfig!=='undefined' && globalConfig)globalConfig.voice_preferences=snapshot;saves=saves.catch(()=>{}).then(()=>window.pywebview.api.save_config({voice_preferences:snapshot})).then(ok=>{if(!ok)throw Error();}).catch(()=>notice('Could not save voice settings.'));}
  function save(){dirty=true;clearTimeout(timer);timer=setTimeout(persist,250);fill();}
  el('voice-language').onchange=()=>{prefs.language=el('voice-language').value;save();};
  el('voice-rate').oninput=()=>{prefs.rate=Number(el('voice-rate').value);save();};
  el('voice-skip').onchange=()=>{prefs.skipCode=el('voice-skip').checked;save();};
  el('voice-remote').onchange=()=>{prefs.allowRemote=el('voice-remote').checked;save();refresh();};
  panel.addEventListener('close',()=>{clearTimeout(timer);if(dirty)persist();});
  async function load(){if(ready || !window.pywebview || !window.pywebview.api)return;try{const cfg=await window.pywebview.api.get_config();if(!dirty)prefs=normalize(cfg.voice_preferences);ready=true;refresh();if(dirty)persist();}catch(e){notice('Voice settings could not be loaded.');}}
  window.addEventListener('pywebviewready',load);load();
  function stop(){generation++;if(supported){synth.cancel();synth.resume();}current=null;chunks=[];index=0;paused=false;player.hidden=true;el('voice-pause').textContent='Pause';}
  function update(label){el('voice-status').textContent=label+' · '+names[language]+' · '+(index+1)+'/'+chunks.length;}
  function next(token){
   if(token!==generation)return;
   if(index>=chunks.length){stop();return;}
   const u=new window.SpeechSynthesisUtterance(chunks[index]);current=u;u.voice=selected;u.lang=selected.lang||language;u.rate=playbackRate;
   u.onstart=()=>{if(token===generation)update('Reading');};
   u.onpause=()=>{if(token===generation)update('Paused');};u.onresume=()=>{if(token===generation)update('Reading');};
   u.onend=()=>{if(token!==generation)return;index++;setTimeout(()=>next(token),0);};
   u.onerror=e=>{if(token!==generation)return;stop();notice('Voice playback failed: '+(e.error||'unknown error')+'. Try another voice.');};
   try{synth.speak(u);}catch(e){stop();notice('Could not start this voice.');}
  }
  function speak(text){
   if(!supported){notice('Read-aloud is not available in this browser.');return;}
   stop();const clean=cleanText(text,prefs.skipCode);if(!clean){notice('There is no readable text after removing formatting and code.');return;}
   language=prefs.language==='auto'?guessLanguage(clean):prefs.language;selected=chooseVoice(synth.getVoices(),language,prefs);
   if(!selected){notice('No eligible '+names[language]+' voice is available. Open Voice & playback and check your installed voices or online-voice opt-in.');return;}
   playbackRate=prefs.rate;chunks=splitText(clean);index=0;paused=false;player.hidden=false;update('Starting');next(generation);
  }
  el('voice-pause').onclick=()=>{if(!current || !supported)return;paused=!paused;el('voice-pause').textContent=paused?'Resume':'Pause';if(paused){update('Pause requested');synth.pause();}else{synth.resume();update('Reading');}};
  el('voice-stop').onclick=stop;
  el('voice-test').onclick=()=>speak(prefs.language==='fr'?'Bonjour, ceci est un essai de la voix française.':prefs.language==='ar'?'مرحباً، هذا اختبار للصوت باللغة العربية.':'Hello, this is a test of the English voice.');
  document.addEventListener('click',event=>{const target=event.target.closest('[data-action="listen-text"]');if(!target || target.closest('.prose'))return;event.preventDefault();event.stopImmediatePropagation();try{speak(decodeURIComponent(target.getAttribute('data-payload')||''));}catch(e){notice('Could not read this reply.');}},true);
  window.addEventListener('beforeunload',stop);
  if(supported && synth.addEventListener)synth.addEventListener('voiceschanged',refresh);
  refresh();window.__asproVoiceReady=true;
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
