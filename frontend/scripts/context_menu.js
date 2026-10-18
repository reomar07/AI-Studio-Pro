/* Editing menu. Never cut from replies or read passwords. */
(function(){
  'use strict';
  function init(){
    const menu=document.createElement('div');menu.id='aspro-context';menu.setAttribute('role','menu');menu.hidden=true;document.body.appendChild(menu);
    let state=null,opening=false,openingId=0;
    function hide(){menu.hidden=true;opening=false;openingId++;}
    function message(t){if(typeof showToast==='function')showToast(t);}
    function restore(s=state){if(!s || !s.field)return;s.field.focus({preventScroll:true});s.field.setSelectionRange(s.start,s.end);}
    function insert(s,text){
      if(s.field.value!==s.value){message('Text changed while the menu was open. Please select it again.');return;}
      restore(s);
      if(!document.execCommand('insertText',false,text)){
        s.field.setRangeText(text,s.start,s.end,'end');s.field.dispatchEvent(new Event('input',{bubbles:true}));
      }
    }
    async function action(name){
      const s=state;hide();if(!s)return;
      try{
        if(name==='copy' || name==='cut'){
          await navigator.clipboard.writeText(s.text);
          if(name==='cut' && s.edit)insert(s,'');else restore(s);
        } else if(name==='paste' && s.edit){
          const text=await navigator.clipboard.readText();insert(s,text);
        } else if(name==='all'){
          if(s.field){s.field.focus({preventScroll:true});s.field.select();}else{const r=document.createRange();r.selectNodeContents(s.container);const sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);}
        } else if((name==='undo' || name==='redo') && s.edit){restore(s);document.execCommand(name);}
      }catch(e){message('Clipboard access was blocked. Use Ctrl+C, Ctrl+X or Ctrl+V in the text field instead.');}
    }
    document.addEventListener('contextmenu',e=>{
      if(e.target.closest('.aspro-panel') && !e.target.matches('input,textarea'))return;
      if(e.target.closest('input[type="password"]'))return;
      const el=e.target.closest('textarea,input');
      const field=el && (el.tagName==='TEXTAREA' || ['text','search','email','url','tel'].includes(el.type))?el:null;
      const container=e.target.closest('.prose, pre, .code-output');
      if(!field && !container)return;
      const start=field?field.selectionStart:0,end=field?field.selectionEnd:0;
      if(field && (start===null || end===null))return;
      const text=field?field.value.slice(start,end):String(window.getSelection()||'');
      state={field,start,end,text,container,value:field?field.value:null,edit:!!(field && !field.readOnly && !field.disabled)};
      e.preventDefault();menu.replaceChildren();
      const entries=[['cut','Cut',state.edit && !!text],['copy','Copy',!!text],['paste','Paste',state.edit],['all','Select all',true],['undo','Undo',state.edit],['redo','Redo',state.edit]];
      entries.forEach(([name,label,enabled])=>{const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');b.textContent=label;b.disabled=!enabled;b.addEventListener('click',()=>action(name));menu.appendChild(b);});
      opening=true;const id=++openingId;
      menu.hidden=false;menu.style.left='0px';menu.style.top='0px';const r=menu.getBoundingClientRect();menu.style.left=Math.max(4,Math.min(e.clientX,window.innerWidth-r.width-8))+'px';menu.style.top=Math.max(4,Math.min(e.clientY,window.innerHeight-r.height-8))+'px';
      menu.querySelector('button:not(:disabled)').focus({preventScroll:true});
      // Let queued focus/layout scroll events settle without dismissing the menu.
      requestAnimationFrame(()=>requestAnimationFrame(()=>{if(id===openingId)opening=false;}));
    });
    document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))hide();});
    window.addEventListener('blur',hide);window.addEventListener('resize',hide);
    document.addEventListener('scroll',e=>{if(!opening && !menu.contains(e.target))hide();},true);
    document.addEventListener('wheel',e=>{if(!menu.contains(e.target))hide();},true);
    document.addEventListener('touchmove',e=>{if(!menu.contains(e.target))hide();},true);
    menu.addEventListener('keydown',e=>{if(e.key==='Escape'){hide();restore();e.stopPropagation();return;}if(!['ArrowDown','ArrowUp'].includes(e.key))return;e.preventDefault();const bs=Array.from(menu.querySelectorAll('button:not(:disabled)'));const i=bs.indexOf(document.activeElement);bs[(i+(e.key==='ArrowDown'?1:bs.length-1))%bs.length].focus({preventScroll:true});});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
