/* Selected-page search with disclosure before the search query is transmitted. */
(function () {
'use strict';
const KEY='aspro_web_search_v1',CONFIG_KEY='web_search_preferences',MAX_PICK=5;
function normalize(raw){return {mode:raw&&raw.mode==='choose'?'choose':'results'};}
function noticeLines(provider,picked){
 const lines=['Search sends up to 300 characters of your question to web search services. Selected websites receive page requests from your internet address.'];
 if(!provider)lines.push('The provider endpoint could not be determined. Do not send if you are unsure where this chat is routed.');
 else lines.push('AI destination: '+provider.profile+' ('+provider.host+'). '+(provider.is_local?'This is a loopback endpoint on this computer; this app cannot verify whether that server forwards requests elsewhere.':'This is not a verified loopback endpoint; treat it as a remote provider.'));
 lines.push('The AI request can include your question, system instructions, earlier conversation turns within the context limit, attached document text, images or PDF page images, and relevant passages from an attached workspace. Earlier turns can include previously supplied web or document text. A separate title request can send up to 500 characters of the initial question to the chat provider.');
 lines.push(picked>0?'For this turn the AI also receives the selected pages: their URLs, titles and up to 6,000 characters of extracted text per page (plus truncation notices). Unreadable pages are reported as unreadable.':'With search-results-only sending, the AI receives the result titles, URLs and snippets. Pages are not downloaded by the page reader.');
 lines.push('Cancel prevents the AI request. If you already confirmed the search, Cancel cannot retract the query sent to search services. Other Web sends and regenerated replies can still include saved context.');
 return lines;
}
async function runGate(deps,original){
 if(deps.mode!=='choose'||!deps.webActive||deps.generating||deps.imageMode||!deps.text)return original();
 const picked=await deps.ask(deps.text);if(picked===null)return;
 try{await deps.api.web_clear_selected_pages();if(picked.length){const result=await deps.api.web_select_pages(picked);if(!result||!result.ok||result.accepted.length!==picked.length)throw Error('Some pages were rejected');}}
 catch(_){try{await deps.api.web_clear_selected_pages();}catch(_){}deps.notify('The chosen pages could not all be prepared. Nothing was sent to the AI. Try again.');return;}
 return original();
}
if(typeof module!=='undefined'&&module.exports)module.exports={normalize,noticeLines,runGate};
if(typeof document==='undefined')return;
let prefs=normalize({}),ready=false,dirty=false,saves=Promise.resolve(),pending=false,saveTicket=0;
try{prefs=normalize(JSON.parse(localStorage.getItem(KEY)||'{}'));}catch(_){}
const byId=id=>document.getElementById(id),toast=t=>{if(typeof showToast==='function')showToast(t);};
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
function sync(){const c=byId('aspro-web-choose');if(c)c.checked=prefs.mode==='choose';try{localStorage.setItem(KEY,JSON.stringify(prefs));}catch(_){}if(typeof globalConfig!=='undefined'&&globalConfig)globalConfig[CONFIG_KEY]={...prefs};}
function persist(previous){sync();if(!ready)return;const snapshot={...prefs},mine=++saveTicket;saves=saves.catch(()=>{}).then(async()=>{try{if(await window.pywebview.api.save_config({[CONFIG_KEY]:snapshot})!==true)throw Error();}catch(_){if(mine===saveTicket){prefs=previous;sync();}toast('Could not save web search preferences.');}});}
async function load(){if(ready||!window.pywebview||!window.pywebview.api)return;try{const cfg=await window.pywebview.api.get_config();if(!dirty&&cfg&&cfg[CONFIG_KEY])prefs=normalize(cfg[CONFIG_KEY]);ready=true;sync();if(dirty)persist(prefs);}catch(_){}}
function addSetting(){const dialog=byId('aspro-preferences');if(!dialog||byId('aspro-web-settings'))return;const section=el('section');section.id='aspro-web-settings';section.className='aspro-feature-section';section.append(el('h3','Web search'));
const label=el('label','Choose pages and show a disclosure before Web sends '),input=el('input');input.type='checkbox';input.id='aspro-web-choose';label.append(input);section.append(label,el('p','Enable this to review the provider disclosure and confirm the query before searching. With this off, Web keeps its automatic search behavior.'));
const reset=byId('aspro-reset');if(reset&&reset.parentNode===dialog)dialog.insertBefore(section,reset);else dialog.append(section);
input.addEventListener('change',()=>{dirty=true;const previous=prefs;prefs=normalize({mode:input.checked?'choose':'results'});persist(previous);});sync();}
async function ask(question){
 let provider=null;try{provider=await window.pywebview.api.web_provider_notice(typeof activeChatId!=='undefined'?activeChatId:null);}catch(_){}
 const query=question.split(/\s+/).filter(Boolean).join(' ').slice(0,300);
 if(!confirm(noticeLines(provider,0).join('\n\n')+'\n\nSearch query: '+query+'\n\nSearch now? Cancel here sends no search query.'))return null;
 return new Promise(resolve=>{
 const dialog=el('dialog');dialog.id='aspro-web-pages';dialog.className='aspro-panel aspro-web-dialog';const list=el('div','Searching…');list.className='aspro-web-list';const notice=el('div');notice.className='aspro-web-notice';const actions=el('div');actions.className='aspro-web-actions';
 const cancel=el('button','Cancel'),plain=el('button','Send with search results only'),read=el('button','Read ticked pages and send');for(const b of [cancel,plain,read]){b.type='button';b.className='aspro-toolbar';}read.disabled=true;plain.disabled=true;
 dialog.append(el('h2','Choose pages to read'),el('p','Search: '+query),list,notice,actions);actions.append(cancel,plain,read);document.body.append(dialog);let settled=false;const boxes=[];
 function finish(value){if(settled)return;settled=true;if(dialog.open)dialog.close();dialog.remove();resolve(value);}
 function renderNotice(){const count=boxes.filter(b=>b.checked).length;read.disabled=count===0;for(const b of boxes)b.disabled=!b.checked&&count>=MAX_PICK;notice.replaceChildren(...noticeLines(provider,count).map(t=>el('p',t)));}
 cancel.onclick=()=>finish(null);plain.onclick=()=>finish([]);read.onclick=()=>finish(boxes.filter(b=>b.checked).map(b=>b.value));dialog.addEventListener('close',()=>finish(null),{once:true});renderNotice();dialog.showModal();
 (async()=>{try{const result=await window.pywebview.api.web_search_preview(question);if(settled)return;list.replaceChildren();if(!result||!result.ok)list.textContent='Search failed. Search-results-only sending will attempt the search again.';else if(!result.results.length)list.textContent='No search results.';
 for(const r of result&&result.ok?result.results:[]){const row=el('label');row.className='aspro-web-row';const b=el('input');b.type='checkbox';b.value=r.url;b.addEventListener('change',renderNotice);boxes.push(b);const text=el('span');text.className='aspro-web-text';text.append(el('strong',r.title),el('small',r.url),el('span',r.snippet));row.append(b,text);list.append(row);}
 }catch(_){if(settled)return;list.textContent='Search unavailable. Sending with search results only will retry.';}if(!settled){plain.disabled=false;renderNotice();}})();
 });
}
function install(){addSetting();const original=window.handleAction;if(typeof original!=='function')throw Error('handleAction unavailable');
window.handleAction=async function(){const self=this,args=arguments;if(typeof isGenerating!=='undefined'&&isGenerating)return original.apply(self,args);if(pending)return;const input=byId('prompt-input'),question=((input&&input.value)||'').trim(),chat=typeof activeChatId!=='undefined'?activeChatId:null;
const deps={mode:prefs.mode,text:question,webActive:typeof isWebSearchActive!=='undefined'&&isWebSearchActive,generating:false,imageMode:typeof isImageMode!=='undefined'&&isImageMode,api:window.pywebview&&window.pywebview.api,notify:toast,ask};
pending=true;try{return await runGate(deps,()=>{if(deps.mode==='choose'&&deps.webActive&&!deps.imageMode&&question&&(((input&&input.value)||'').trim()!==question||(typeof activeChatId!=='undefined'?activeChatId:null)!==chat)){deps.api.web_clear_selected_pages().catch(()=>{});toast('The conversation or question changed. Please send again.');return;}return original.apply(self,args);});}finally{pending=false;}};
window.addEventListener('pywebviewready',load);load();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
window.AsproWebPages={version:1,getPreferences:()=>({...prefs})};window.__asproWebPagesVersion=1;
})();
