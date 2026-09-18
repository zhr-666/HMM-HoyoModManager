'use strict';
// Keep real parent nodes alive: selections, scroll positions and listeners survive.
class DialogStack {
 constructor(ids){this.templates=new Map(ids.map(id=>[id,document.getElementById(id).cloneNode(true)]));this.layers=[];this.serial=0;}
 open(id,onBack){
  const previous=document.getElementById(id),suspended=[];
  let dialog=previous;
  if(previous.open){
   const tip=document.getElementById('help-tooltip');if(tip&&previous.contains(tip)){tip.hidden=true;document.body.append(tip);}
   for(const node of [previous,...previous.querySelectorAll('[id]')]){suspended.push([node,node.id]);node.dataset.layerId=node.id;node.id='suspended-'+(++this.serial)+'-'+node.id;}
   dialog=this.templates.get(id).cloneNode(true);document.body.append(dialog);
  }
  dialog.dataset.layerKind=id;
  dialog.dataset.layerRevision=String(++this.serial);
  const layer={dialog,suspended,onBack};this.layers.push(layer);
  const back=document.createElement('button');back.type='button';back.className='button secondary dialog-back';back.innerHTML='<svg class="icon" aria-hidden="true"><use href="#i-back"/></svg> 返回';back.onclick=()=>onBack?onBack():this.back(dialog);
  dialog.querySelector('.dialog-head').prepend(back);
  dialog.oncancel=e=>{e.preventDefault();onBack?onBack():this.back(dialog);};
  dialog.onsubmit=e=>{e.preventDefault();onBack?onBack():this.back(dialog);};
  dialog.showModal();return dialog;
 }
 back(dialog){
  const index=this.layers.findIndex(x=>x.dialog===dialog);if(index<0)return;
  if(index!==this.layers.length-1)return;
  const layer=this.layers.pop();const tip=document.getElementById('help-tooltip');if(tip&&dialog.contains(tip)){tip.hidden=true;document.body.append(tip);}
  dialog.close();dialog.querySelector('.dialog-back')?.remove();
  if(layer.suspended.length){dialog.remove();for(const [node,id] of layer.suspended)node.id=id;for(const node of layer.suspended[0][0].querySelectorAll('[data-layer-id]'))node.id=node.dataset.layerId;}
 }
}
window.DialogStack=DialogStack;
