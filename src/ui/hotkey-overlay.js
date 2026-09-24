'use strict';
const $=selector=>document.querySelector(selector);
const mode=new URLSearchParams(location.search).get('mode');
const entry=mode==='entry';
$('#entry').hidden=!entry;$('#detail').hidden=entry;
let current=null;
function node(tag,className,text){const item=document.createElement(tag);if(className)item.className=className;if(text!=null)item.textContent=String(text);return item;}
function render(state){
 current=state;
 const match=state?.match,settings=state?.settings||{};
 document.documentElement.style.setProperty('--font-size',`${settings.fontSize||15}px`);
 document.documentElement.style.setProperty('--entry-font-size',`${Math.min(settings.fontSize||15,Math.max(12,Math.floor((settings.entrySize||96)*.22)))}px`);
 if(!match)return;
 if(entry){$('#entry-role').textContent=match.character;$('#open').setAttribute('aria-label',`查看${match.character}的热键`);return;}
 $('#detail-role').textContent=match.character;
 const list=$('#hotkey-list');list.replaceChildren();
 for(const mod of match.mods){
  const card=node('section','mod');card.append(node('h2','',mod.name));
  for(const note of mod.notes||[])card.append(node('p','note',note));
  for(const binding of mod.bindings||[]){
   const row=node('div','binding'),name=node('span','binding-name',binding.section),keys=node('span','keys');
   for(const key of binding.keys||[])keys.append(node('kbd','',key));
   if(binding.back?.length){keys.append(node('span','', '↩'));for(const key of binding.back)keys.append(node('kbd','',key));}
   row.append(name,keys);card.append(row);
  }
  list.append(card);
 }
 $('#entry-size').value=settings.entrySize;$('#font-size').value=settings.fontSize;
 $('#entry-size-value').textContent=`${settings.entrySize}px`;
 $('#font-size-value').textContent=`${settings.fontSize}px`;
}
window.hoyoOverlay.onState(render);
window.hoyoOverlay.call('state').then(render).catch(()=>{});
$('#open').onclick=()=>window.hoyoOverlay.call('open').catch(()=>{});
$('#close').onclick=()=>window.hoyoOverlay.call('close').catch(()=>{});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!entry)window.hoyoOverlay.call('close').catch(()=>{});});
for(const id of ['entry-size','font-size']){
 const input=$(`#${id}`),output=$(`#${id}-value`);
 input.oninput=()=>{output.textContent=`${input.value}px`;};
 input.onchange=()=>window.hoyoOverlay.call('settings',{entrySize:Number($('#entry-size').value),fontSize:Number($('#font-size').value)}).then(state=>{$('#settings-error').hidden=true;render(state);}).catch(()=>{$('#settings-error').textContent='设置保存失败，请重试。';$('#settings-error').hidden=false;});
}
