'use strict';
const $=selector=>document.querySelector(selector);
const mode=new URLSearchParams(location.search).get('mode');
const entry=mode==='entry';
$('#entry').hidden=!entry;$('#detail').hidden=entry;
let current=null,gesture=null,deferredState=null,animation=null,animationSequence=-1;
function node(tag,className,text){const item=document.createElement(tag);if(className)item.className=className;if(text!=null)item.textContent=String(text);return item;}
function morph(state){
 if(entry)return;
 const panel=$('#detail');
 const opening=state.phase==='opening',closing=state.phase==='closing';
 if(!state.active||(!opening&&!closing)){animation?.cancel();animation=null;animationSequence=state.sequence;panel.classList.remove('animating');return;}
 if(animationSequence===state.sequence)return;
 animationSequence=state.sequence;
 const start=animation?{left:getComputedStyle(panel).left,top:getComputedStyle(panel).top,width:getComputedStyle(panel).width,height:getComputedStyle(panel).height,borderRadius:getComputedStyle(panel).borderRadius}:null;
 animation?.cancel();
 const origin=state.origin||{x:0,y:0,size:96};
 const circle={left:`${origin.x}px`,top:`${origin.y}px`,width:`${origin.size}px`,height:`${origin.size}px`,borderRadius:`${origin.size/2}px`};
 const full={left:'0px',top:'0px',width:'360px',height:'420px',borderRadius:'16px'};
 panel.classList.add('animating');
 const sequence=state.sequence;
 animation=panel.animate([start||(opening?circle:full),opening?full:circle],{duration:matchMedia('(prefers-reduced-motion: reduce)').matches?1:240,easing:'cubic-bezier(.2,.75,.25,1)',fill:'forwards'});
 animation.finished.then(()=>{
  if(sequence!==animationSequence)return;
  if(opening)panel.classList.remove('animating');
  window.hoyoOverlay.call('transition-end',{sequence}).catch(()=>{});
 }).catch(()=>{});
}
function render(state){
 current=state;
 if(entry&&gesture&&state.active){deferredState=state;return;}
 morph(state);
 const match=entry?state?.entryMatch:state?.match,settings=state?.settings||{};
 document.documentElement.style.setProperty('--font-size',`${settings.fontSize||15}px`);
 document.documentElement.style.setProperty('--entry-font-size',`${Math.min(settings.fontSize||15,Math.max(12,Math.floor((settings.entrySize||96)*.22)))}px`);
 const idle=!match;
 $('#entry').classList.toggle('idle',idle);
 $('#idle-logo').hidden=!idle;
 $('#open').hidden=idle;
 if(!match)return;
 if(entry){$('#entry-role').textContent=match.character;$('#open').setAttribute('aria-label',`查看${match.character}的热键`);return;}
 $('#detail-role').textContent=match.character;
 const list=$('#hotkey-list');list.replaceChildren();
 if(!match.mods.length)list.append(node('p','empty','该角色当前没有已启用模组的热键或提示。'));
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
// Pointer capture keeps the same drag target even when recognition changes.
// Native app-region dragging cannot safely survive replacing that region's DOM.
const entryNode=$('#entry');
entryNode.addEventListener('pointerdown',event=>{
 if(!entry||event.button!==0||gesture)return;
 event.preventDefault();gesture={id:event.pointerId,x:event.screenX,y:event.screenY,moved:false};
 entryNode.setPointerCapture(event.pointerId);
 window.hoyoOverlay.call('drag-start').catch(()=>{});
});
entryNode.addEventListener('pointermove',event=>{
 if(!gesture||event.pointerId!==gesture.id)return;
 if(Math.hypot(event.screenX-gesture.x,event.screenY-gesture.y)>4)gesture.moved=true;
 if(gesture.moved){entryNode.classList.add('dragging');window.hoyoOverlay.call('drag-move').catch(()=>{});}
});
function release(event,cancelled=false){
 if(!gesture||event.pointerId!==gesture.id)return;
 const open=!cancelled&&!gesture.moved;const id=gesture.id;gesture=null;
 if(entryNode.hasPointerCapture(id))entryNode.releasePointerCapture(id);
 entryNode.classList.remove('dragging');
 if(deferredState){const state=deferredState;deferredState=null;render(state);}
 window.hoyoOverlay.call('drag-end').then(()=>{if(open&&current?.active&&current.entryMatch)return window.hoyoOverlay.call('open');}).catch(()=>{});
}
entryNode.addEventListener('pointerup',event=>release(event));
entryNode.addEventListener('pointercancel',event=>release(event,true));
entryNode.addEventListener('lostpointercapture',event=>release(event,true));
$('#open').onclick=event=>{if(event.detail===0&&!gesture)window.hoyoOverlay.call('open').catch(()=>{});};
$('#close').onclick=()=>window.hoyoOverlay.call('close').catch(()=>{});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!entry)window.hoyoOverlay.call('close').catch(()=>{});});
for(const id of ['entry-size','font-size']){
 const input=$(`#${id}`),output=$(`#${id}-value`);
 input.oninput=()=>{output.textContent=`${input.value}px`;};
 input.onchange=()=>window.hoyoOverlay.call('settings',{entrySize:Number($('#entry-size').value),fontSize:Number($('#font-size').value)}).then(state=>{$('#settings-error').hidden=true;render(state);}).catch(()=>{$('#settings-error').textContent='设置保存失败，请重试。';$('#settings-error').hidden=false;});
}
