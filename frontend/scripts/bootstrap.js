/* Load preview modules after the original chat controller and show startup status. */
if (window.tailwind) window.tailwind.config = { darkMode: 'class' };
(function () {
  'use strict';
  const errors=[];
  window.addEventListener('error',event=>{
    if(String(event.filename||'').includes('frontend/scripts/'))errors.push(event.message||'Script error');
  });
  async function start(){
    if(document.getElementById('aspro-feature-status'))return;
    const badge=document.createElement('button');badge.id='aspro-feature-status';badge.type='button';
    badge.textContent='Themes preview 2: loading';
    badge.style.cssText='position:fixed;top:48px;right:12px;z-index:90;padding:4px 9px;border:1px solid #64748b;border-radius:7px;background:#1e293b;color:#fff;font:11px Segoe UI,Arial;cursor:pointer';
    badge.title='Click for preview status';document.body.appendChild(badge);
    function loadScript(file){return new Promise((resolve,reject)=>{
      const s=document.createElement('script');s.src='frontend/scripts/'+file+'?preview=voice-1';s.onload=resolve;s.onerror=()=>reject(new Error('Could not load '+file));document.body.appendChild(s);
    });}
    try{
      await new Promise((resolve,reject)=>{
        const link=document.createElement('link');link.rel='stylesheet';link.href='frontend/styles/themes.css?themes-preview=2';link.onload=resolve;link.onerror=()=>reject(new Error('Could not load themes.css'));document.head.appendChild(link);
      });
      await loadScript('appearance.js');
      if(!document.getElementById('aspro-preferences') || !document.documentElement.dataset.asproTheme){
        throw new Error(errors.join('; ') || 'Appearance script did not finish initialization');
      }
      await loadScript('context_menu.js');
      if(!document.getElementById('aspro-context'))throw new Error('Right-click menu did not initialize');
      await loadScript('speech.js');
      if(!window.__asproVoiceReady)throw new Error(errors.join('; ') || 'Voice module did not initialize');
      badge.textContent='Themes preview 2: ready';badge.style.background='#14532d';
      badge.title='Themes and voice controls loaded';
      badge.onclick=()=>{
        const dialog=document.getElementById('aspro-preferences');if(dialog && !dialog.open)dialog.showModal();
      };
      window.__asproFeaturesReady=true;
    }catch(error){
      badge.textContent='Preview startup failed (click)';badge.style.background='#7f1d1d';
      const detail=String(error.message||error)+'\n\nPage: '+location.href;
      badge.onclick=()=>alert(detail);badge.title=detail;console.error('Preview:',detail);
      window.__asproFeaturesError=detail;
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
