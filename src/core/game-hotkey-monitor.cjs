'use strict';
const {cropRect,matchEnabledMods,StableRole}=require('./game-hotkey-match.cjs');

class GameHotkeyMonitor{
 constructor({capture,ocr,getMods,getNotes,onChange=()=>{},onError=()=>{},intervalMs=2000}){
  Object.assign(this,{capture,ocr,getMods,getNotes,onChange,onError,intervalMs});
  this.stable=new StableRole(2);this.current=null;this.errorReported=false;this.running=false;this.timer=null;this.inFlight=null;
 }
 emit(value){
  const old=JSON.stringify(this.current),next=JSON.stringify(value);
  this.current=value;if(old!==next)this.onChange(value);
 }
 hide(){this.stable.reset();this.emit(null);}
 sample(){
  if(this.inFlight)return this.inFlight;
  this.inFlight=this._sample().finally(()=>{this.inFlight=null;});return this.inFlight;
 }
 async _sample(){
  try{
   const frame=await this.capture();
   if(!frame){this.hide();this.errorReported=false;return;}
   const rect=frame.rect||cropRect(frame.imageWidth,frame.imageHeight,frame.displayWidth,frame.displayHeight);
   if(!rect){this.hide();this.errorReported=false;return;}
   const text=await this.ocr(frame.image,rect);
   const mods=this.getMods(),notes=this.getNotes();
   const candidate=matchEnabledMods(text,mods,notes);
   const selected=this.stable.observe(candidate?.character||null);
   this.emit(selected?matchEnabledMods('/'+selected,mods,notes):null);
   this.errorReported=false;
  }catch(error){
   this.hide();if(!this.errorReported){this.errorReported=true;this.onError(error);}
  }
 }
 start(){
  if(this.running)return;this.running=true;
  const tick=async()=>{await this.sample();if(this.running)this.timer=setTimeout(tick,this.intervalMs);};
  this.timer=setTimeout(tick,0);
 }
 async stop(){
  this.running=false;clearTimeout(this.timer);if(this.inFlight)await this.inFlight;this.hide();
 }
}

module.exports={GameHotkeyMonitor};
