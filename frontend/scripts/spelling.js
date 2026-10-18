/* Explicit local spelling suggestions. Only the selected word/caret word is checked. */
(function(){
 'use strict';
 const wordPattern=/^[\p{Script=Latin}\p{M}]+(?:['’-][\p{Script=Latin}\p{M}]+)*$/u;
 function selectedWord(value,start,end){
  if(typeof value!=='string' || !Number.isInteger(start) || !Number.isInteger(end) || start<0 || end<start || end>value.length)return null;
  if(start===end){while(start>0 && /[\p{Script=Latin}\p{M}'’-]/u.test(value[start-1]))start--;while(end<value.length && /[\p{Script=Latin}\p{M}'’-]/u.test(value[end]))end++;}
  const word=value.slice(start,end);return word.length>=2 && word.length<=32 && wordPattern.test(word)?{start,end,word}:null;
 }
 if(typeof module!=='undefined' && module.exports)module.exports={selectedWord};
 if(typeof document==='undefined')return;
 function init(){
  let language='en',dirty=false,request=0;
  async function load(){if(!window.pywebview || !window.pywebview.api)return;try{const c=await window.pywebview.api.get_config();if(!dirty)language=c.spelling_preferences && c.spelling_preferences.language==='fr'?'fr':'en';}catch(e){}}
  window.addEventListener('pywebviewready',load);load();
  document.addEventListener('contextmenu',event=>{
   const field=event.target.closest('textarea,input');const menu=document.getElementById('aspro-context');
   if(!menu || menu.hidden || !field || field.type==='password' || field.readOnly || field.disabled || field.selectionStart===null)return;
   const snapshot=field.value,range=selectedWord(snapshot,field.selectionStart,field.selectionEnd);
   const section=document.createElement('div');section.style.cssText='border-top:1px solid var(--ui-border);margin-top:5px;padding-top:5px';
   const label=document.createElement('label');label.textContent='Spelling (offline) ';label.style.cssText='display:block;padding:4px 8px;font-size:12px';
   const select=document.createElement('select');select.setAttribute('aria-label','Spelling language');select.style.cssText='width:100%;background:var(--ui-surface);color:var(--ui-text);border:1px solid var(--ui-border);padding:4px';
   for(const [id,name] of [['en','English'],['fr','French']]){const o=document.createElement('option');o.value=id;o.textContent=name;select.appendChild(o);}select.value=language;label.appendChild(select);section.appendChild(label);
   const results=document.createElement('div');section.appendChild(results);menu.appendChild(section);menu.style.maxHeight='min(65vh,420px)';menu.style.overflowY='auto';
   function fit(){const r=menu.getBoundingClientRect();menu.style.top=Math.max(4,Math.min(r.top,window.innerHeight-r.height-8))+'px';}
   function status(text){results.replaceChildren();const p=document.createElement('p');p.style.cssText='font-size:12px;padding:5px 8px';p.textContent=text;results.appendChild(p);fit();}
   function notice(t){if(typeof showToast==='function')showToast(t);}
   async function query(){
    const id=++request;
    if(!range){status('Select an English or French word, or place the caret inside one.');return;}
    status('Checking '+range.word+'…');
    try{
     const r=await window.pywebview.api.get_spelling_suggestions(range.word,language);
     if(id!==request || menu.hidden || !section.isConnected)return;
     status(r.message||'No suggestions.');
     for(const suggestion of r.suggestions||[]){
      const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');b.textContent=suggestion;b.title='Replace '+range.word+' with '+suggestion;
      b.onclick=()=>{
       if(field.value!==snapshot || !field.isConnected){notice('The text changed. Select the word again.');return;}
       menu.hidden=true;request++;field.focus({preventScroll:true});field.setSelectionRange(range.start,range.end);
       if(!document.execCommand('insertText',false,suggestion)){field.setRangeText(suggestion,range.start,range.end,'end');field.dispatchEvent(new Event('input',{bubbles:true}));}
      };results.appendChild(b);
     }
     fit();
    }catch(e){if(id===request && !menu.hidden && section.isConnected)status('Spelling is unavailable in this app version.');}
   }
   select.onchange=async()=>{language=select.value;dirty=true;const prefs={language};if(typeof globalConfig!=='undefined' && globalConfig)globalConfig.spelling_preferences=prefs;query();try{const ok=await window.pywebview.api.save_config({spelling_preferences:prefs});if(!ok)throw Error();}catch(e){notice('Could not save spelling language.');}};
   query();
  });
  window.__asproSpellingReady=true;
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
