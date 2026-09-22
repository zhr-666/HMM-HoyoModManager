'use strict';
// This file follows app.js and shares the application's game-scoped settings helpers.
window.hoyoProgramSettings=function(root){
 const primary=root.querySelector('[data-game-value="launchExe"]')?.closest('.setting-row');
 if(!primary||root.querySelector('[data-program-tabs]'))return;
 const secondary=document.createElement('div');secondary.className='setting-row';
 secondary.innerHTML='<div><strong>二级程序</strong><p data-secondary-program>尚未选择</p></div><div class="row-actions"><button type="button" class="button secondary" data-choose-secondary>选择 EXE</button><button type="button" class="button secondary" data-clear-secondary>清除</button></div>';
 const toggle=document.createElement('div');toggle.className='setting-row';
 toggle.innerHTML='<div><strong>窗口标签页</strong><p>需要以管理员身份运行 HMM</p></div><label class="switch"><input type="checkbox" data-program-tabs aria-label="窗口标签页"><span></span></label>';
 primary.after(secondary,toggle);
 secondary.querySelector('[data-choose-secondary]').onclick=()=>call('chooseProgram',{gameId:activeGame,level:2},{reload:true}).catch(()=>{});
 secondary.querySelector('[data-clear-secondary]').onclick=()=>call('settings',{gameId:activeGame,secondaryExe:''},{reload:true}).catch(()=>{});
 toggle.querySelector('input').onchange=async event=>{const input=event.target,value=input.checked;input.disabled=true;try{await call('settings',{gameId:activeGame,programTabs:value},{reload:true});}catch{input.checked=!value;}finally{input.disabled=false;}};
 renderGameValues(root);
};
window.hoyoProgramSettings(document.querySelector('#game-settings-panel'));
(()=>{
 const nav=document.querySelector('#program-tabs');let signature='';
 function render(value){
  if(!value?.tabs)return;
  const next=JSON.stringify(value);if(next===signature)return;signature=next;
  nav.hidden=value.tabs.length===0;nav.replaceChildren();
  document.documentElement.dataset.programTab=value.selected?'external':'hmm';
  for(const tab of [{id:'',label:'HMM'},...value.tabs.map(t=>({...t,label:gameById(t.gameId).name+' · '+(t.level===1?'一级程序':'二级程序')}))]){
   const button=document.createElement('button');button.type='button';button.textContent=tab.label;button.className='program-tab';button.setAttribute('aria-pressed',String(tab.id===value.selected));
   button.onclick=()=>call('selectProgramTab',{id:tab.id},{foreground:false}).catch(()=>{});nav.append(button);
  }
 }
 api?.onProgramTabs?.(render);
 api?.call('programTabState').then(render).catch(()=>{});
})();
