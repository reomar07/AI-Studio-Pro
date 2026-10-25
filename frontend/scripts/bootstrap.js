/* Model favorites preview 1; keep existing appearance, voice and spelling hooks. */
if (window.tailwind) window.tailwind.config = { darkMode: 'class' };
(function () {
  'use strict';
  const errors=[];
  window.addEventListener('error',event=>{if(String(event.filename||'').includes('frontend/scripts/'))errors.push(event.message||'Script error');});
  async function start(){
    if(document.getElementById('aspro-feature-status'))return;
    const badge=document.createElement('button');badge.id='aspro-feature-status';badge.type='button';badge.textContent='Models preview 1: loading';
    badge.style.cssText='position:fixed;top:48px;right:12px;z-index:90;padding:4px 9px;border:1px solid #64748b;border-radius:7px;background:#1e293b;color:#fff;font:11px Segoe UI,Arial;cursor:pointer';
    document.body.appendChild(badge);
    function loadScript(file){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='frontend/scripts/'+file+'?preview=spelling-2';s.onload=resolve;s.onerror=()=>reject(new Error('Could not load '+file));document.body.appendChild(s);});}
    try{
      await new Promise((resolve,reject)=>{const link=document.createElement('link');link.rel='stylesheet';link.href='frontend/styles/themes.css?themes-preview=2';link.onload=resolve;link.onerror=()=>reject(new Error('Could not load themes.css'));document.head.appendChild(link);});
      await loadScript('appearance.js');
      if(!document.getElementById('aspro-preferences') || !document.documentElement.dataset.asproTheme)throw new Error(errors.join('; ') || 'Appearance initialization failed');
      await loadScript('context_menu.js');
      if(window.__asproContextMenuVersion!==2)throw new Error('Menu version mismatch. Replace the whole frontend folder.');
      await loadScript('speech.js');
      if(!window.__asproVoiceReady)throw new Error(errors.join('; ') || 'Voice initialization failed');
      await loadScript('spelling.js');
      if(!window.AsproSpelling || window.AsproSpelling.version!==2)throw new Error('Spelling hook version mismatch. Replace the whole frontend folder.');
      await loadScript('model_favorites.js');
      if(window.__asproModelFavoritesVersion!==1)throw new Error('Model shortcuts module did not initialize. Replace the whole frontend folder.');
      await loadScript('usage_summary.js');
      if(window.__asproUsageSummaryVersion!==1)throw new Error('Token summary module did not initialize. Replace the whole frontend folder.');
      badge.textContent='Models preview 1: ready';badge.dataset.spellingPreview='2';badge.style.background='#14532d';badge.title='Interface modules loaded: themes, voice, spelling menu, model shortcuts and token summary. Dictionary and provider availability are checked when used.';
      badge.onclick=()=>{const d=document.getElementById('aspro-preferences');if(d && !d.open)d.showModal();};
      window.__asproFeaturesReady=true;
    }catch(error){
      badge.textContent='Preview startup failed (click)';badge.style.background='#7f1d1d';const detail=String(error.message||error)+'\n\nPage: '+location.href;
      badge.onclick=()=>alert(detail);badge.title=detail;console.error('Preview:',detail);window.__asproFeaturesError=detail;
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
