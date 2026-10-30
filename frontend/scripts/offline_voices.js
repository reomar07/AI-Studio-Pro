/* Downloadable Piper library; existing voice preferences and data paths are preserved. */
(function () {
'use strict';
const LANGS=['en','fr','ar'], NAMES={en:'English',fr:'French',ar:'Arabic'}, KEY='aspro_offline_voices_v1';
function normalize(raw){raw=raw&&typeof raw==='object'?raw:{};const voices={};for(const l of LANGS)voices[l]=typeof (raw.voices||{})[l]==='string'?raw.voices[l].slice(0,100):'';return {voices};}
function cleanText(text,skipCode){let t=String(text||'');if(skipCode!==false)t=t.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g,' ');return t.replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,' ').replace(/<[^>]*>/g,' ').replace(/[*#_`~>]/g,'').replace(/\p{Extended_Pictographic}|\uFE0F/gu,'').replace(/\|/g,', ').replace(/[ \t]+/g,' ').trim();}
function guessLanguage(text){if((text.match(/[\u0600-\u06ff]/g)||[]).length>(text.match(/[a-z]/gi)||[]).length/2)return 'ar';if(/[àâçéèêëîïôùûüœ]/i.test(text)||(text.match(/\b(bonjour|vous|nous|les|des|une|avec|pour|dans|est)\b/gi)||[]).length>=2)return 'fr';return 'en';}
function splitText(text,max=350){const out=[];let rest=String(text||'').trim();while(rest.length>max){let cut=rest.slice(0,max).lastIndexOf(' ');if(cut<1)cut=max;out.push(rest.slice(0,cut));rest=rest.slice(cut).trim();}if(rest)out.push(rest);return out;}
function chooseOfflineVoice(prefs,status,lang){const id=prefs.voices[lang];return status&&status.engine&&id&&status.voices.some(v=>v.id===id&&v.lang===lang&&v.installed)?id:'';}
function filterVoices(list,lang,query){const q=String(query||'').toLowerCase();return list.filter(v=>(lang==='all'||v.lang===lang)&&(v.label+' '+v.id).toLowerCase().includes(q));}
if(typeof module!=='undefined'&&module.exports)module.exports={normalize,cleanText,guessLanguage,splitText,chooseOfflineVoice,filterVoices};
if(typeof document==='undefined')return;
if(window.__asproOfflineVoicesVersion)return;
const api=()=>window.pywebview&&window.pywebview.api;
const toast=t=>{if(typeof showToast==='function')showToast(t);};
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const button=(text,fn)=>{const b=el('button',text);b.type='button';b.className='aspro-toolbar';b.onclick=fn;return b;};
let prefs=normalize({}),status=null,ready=false,dirty=false,serial=0,queue=Promise.resolve(),poller=null,token=0,audio=null,settleAudio=null;
try{prefs=normalize(JSON.parse(localStorage.getItem(KEY)||'{}'));}catch(_){}
const panel=el('dialog');panel.id='aspro-offline-voices';panel.className='aspro-panel';panel.style.cssText='width:min(680px,94vw);max-height:85vh;overflow:auto';
const form=el('form');form.method='dialog';const head=el('header');head.append(el('h2','Offline voice library'),el('button','Close'));form.append(head);panel.append(form);
panel.append(el('p','Voices download once from Hugging Face into your app data folder. Speech is generated on this computer. Quality labels are model variants, not guarantees that a voice sounds better.'));
const hint=el('p'),preferred=el('div'),filters=el('div'),list=el('div'),folder=el('p');hint.setAttribute('role','status');
const language=el('select');language.setAttribute('aria-label','Filter voice language');
for(const [value,name] of [['all','All languages'],...LANGS.map(l=>[l,NAMES[l]])]){const o=el('option',name);o.value=value;language.append(o);}
const search=el('input');search.type='search';search.placeholder='Find a voice';search.setAttribute('aria-label','Search voices');filters.append(language,search);filters.style.cssText='display:flex;gap:8px;margin:12px 0';panel.append(hint,preferred,filters,list,folder);
async function refresh(){if(!api())return;try{status=await api().offline_voices_status();render();}catch(_){hint.textContent='Voice information could not be loaded.';}}
function writeLocal(){try{localStorage.setItem(KEY,JSON.stringify(prefs));}catch(_){}if(typeof globalConfig!=='undefined'&&globalConfig)globalConfig.offline_voice_preferences=normalize(prefs);}
function selectVoice(lang,id){const previous=normalize(prefs),mine=++serial;dirty=true;prefs.voices[lang]=id;writeLocal();render();if(!ready)return;const snapshot=normalize(prefs);queue=queue.catch(()=>{}).then(async()=>{try{const ok=await api().save_config({offline_voice_preferences:snapshot});if(ok!==true)throw Error();}catch(_){if(mine===serial){prefs=previous;writeLocal();render();}toast('Could not save the preferred offline voice.');}});}
function render(){if(!status)return;hint.textContent=status.engine?'Piper engine available.':status.hint;folder.textContent='Voice folder: '+status.folder;preferred.replaceChildren();
for(const l of LANGS){const label=el('label',NAMES[l]+' preferred voice '),select=el('select');select.setAttribute('aria-label',NAMES[l]+' preferred voice');const fallback=el('option','Use Windows/browser voice');fallback.value='';select.append(fallback);
for(const v of status.voices.filter(v=>v.lang===l&&v.installed)){const o=el('option',v.label);o.value=v.id;select.append(o);}
if(prefs.voices[l]&&!status.voices.some(v=>v.id===prefs.voices[l]&&v.installed)){const o=el('option','Saved voice unavailable');o.value=prefs.voices[l];o.disabled=true;select.append(o);}
select.value=prefs.voices[l];select.disabled=!ready||!status.engine;select.onchange=()=>selectVoice(l,select.value);label.append(select);label.style.cssText='display:block;margin:8px 0';preferred.append(label);}
list.replaceChildren();const matches=filterVoices(status.voices,language.value||'all',search.value);
if(!matches.length)list.append(el('p','No matching voices.'));
for(const v of matches){const row=el('section');row.style.cssText='border-top:1px solid var(--ui-border);padding:10px 0';row.append(el('h3',v.label),el('p',NAMES[v.lang]+' · approximately '+v.size_mb+' MB · '+(v.downloading?'Downloading '+Math.round(v.progress*100)+'%':v.installed?'Installed':'Not downloaded')));
const actions=el('div');actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
const card=button('Model card / license',()=>api().open_external_url('https://huggingface.co/rhasspy/piper-voices/blob/main/'+v.id.split('-')[0].split('_')[0]+'/'+v.id.split('-')[0]+'/'+v.id.split('-')[1]+'/'+v.id.split('-')[2]+'/MODEL_CARD'));actions.append(card);
if(v.error)row.append(el('p','Download failed: '+v.error));
if(v.installed){const test=button('Preview',()=>speak(v.lang==='fr'?'Bonjour, ceci est un essai de la voix.':v.lang==='ar'?'مرحباً، هذا اختبار للصوت.':'Hello, this is a test of the offline voice.',v.id));test.disabled=!status.engine;actions.append(test,button('Delete',async()=>{if(!confirm('Delete the downloaded files for '+v.label+'?'))return;try{const result=await api().offline_voice_delete(v.id);if(!result.ok){toast(result.message);return;}if(prefs.voices[v.lang]===v.id)selectVoice(v.lang,'');await refresh();}catch(_){toast('Could not delete this voice.');}}));}
else if(!v.downloading)actions.append(button('Download',async()=>{if(!confirm('Download '+v.label+' (approximately '+v.size_mb+' MB) from Hugging Face? Review its model card for license terms. No speech text is sent.'))return;try{const result=await api().offline_voice_download(v.id);if(!result.ok)toast(result.message);await refresh();startPolling();}catch(_){toast('Could not start the voice download.');}}));
row.append(actions);list.append(row);}}
language.onchange=render;search.oninput=render;
function startPolling(){clearInterval(poller);poller=setInterval(async()=>{await refresh();if(!panel.open||!status||!status.voices.some(v=>v.downloading))clearInterval(poller);},1500);}
const player=el('div');player.id='aspro-offline-player';player.hidden=true;const text=el('span'),pause=button('Pause',()=>{if(!audio)return;if(audio.paused){audio.play().catch(()=>toast('Could not resume audio.'));pause.textContent='Pause';}else{audio.pause();pause.textContent='Resume';}});
function stop(){token++;if(audio){audio.pause();audio=null;}if(settleAudio){settleAudio(false);settleAudio=null;}player.hidden=true;pause.textContent='Pause';}
player.append(text,pause,button('Stop',stop));
function play(url,mine){return new Promise(resolve=>{if(mine!==token){resolve(false);return;}audio=new Audio(url);settleAudio=resolve;audio.onended=()=>{settleAudio=null;resolve(true);};audio.onerror=()=>{settleAudio=null;resolve(false);};audio.play().catch(()=>resolve(false));});}
async function speak(value,id){stop();const mine=token;const options=typeof globalConfig!=='undefined'&&globalConfig?globalConfig.voice_preferences||{}:{};const chunks=splitText(cleanText(value,options.skipCode));if(!chunks.length){toast('There is no readable text.');return;}if(window.speechSynthesis)window.speechSynthesis.cancel();player.hidden=false;
try{for(let i=0;i<chunks.length;i++){if(mine!==token)return;text.textContent='Preparing offline speech '+(i+1)+'/'+chunks.length;const r=await api().offline_voice_speak(chunks[i],id,Number(options.rate)||1);if(mine!==token)return;if(!r||!r.ok)throw Error(r&&r.error||'Speech generation failed');text.textContent='Reading '+(i+1)+'/'+chunks.length;if(!await play(r.audio,mine)){if(mine===token)throw Error('Audio playback failed');return;}}if(mine===token)stop();}catch(e){if(mine===token){stop();toast('Offline voice: '+e.message);}}}
async function load(){if(ready||!api())return;try{const cfg=await api().get_config();if(!dirty&&cfg.offline_voice_preferences)prefs=normalize(cfg.offline_voice_preferences);ready=true;await refresh();}catch(_){toast('Offline voice settings could not be loaded.');}}
function init(){document.body.append(panel,player);const slot=document.querySelector('aside > div:last-child');if(slot)slot.append(button('Offline voices',async()=>{await load();await refresh();if(!panel.open)panel.showModal();startPolling();}));panel.addEventListener('close',()=>clearInterval(poller));
document.addEventListener('click',event=>{const target=event.target.closest('[data-action="listen-text"]');if(!target||target.closest('.prose'))return;let value;try{value=decodeURIComponent(target.getAttribute('data-payload')||'');}catch(_){return;}const options=typeof globalConfig!=='undefined'&&globalConfig?globalConfig.voice_preferences||{}:{};const lang=LANGS.includes(options.language)?options.language:guessLanguage(cleanText(value,true));const id=chooseOfflineVoice(prefs,status,lang);if(!id){stop();return;}event.preventDefault();event.stopImmediatePropagation();speak(value,id);},true);
window.addEventListener('beforeunload',stop);window.addEventListener('pywebviewready',load);load();window.__asproOfflineVoicesVersion=1;}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
