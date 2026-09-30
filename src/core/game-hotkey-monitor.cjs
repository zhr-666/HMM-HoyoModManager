'use strict';
const {cropRect,matchEnabledMods,StableRole,resolveScreenRoleEvidence,ROLE_NAMES}=require('./game-hotkey-match.cjs');
const {matchRoleGlyph}=require('./game-role-glyph.cjs');

class GameHotkeyMonitor{
 constructor({capture,ocr,getMods,getNotes,onChange=()=>{},onError=()=>{},intervalMs=2000,now=Date.now,matchGlyph=png=>matchRoleGlyph(png,require('electron').nativeImage)}){
  Object.assign(this,{capture,ocr,getMods,getNotes,onChange,onError,intervalMs,now,matchGlyph});
  this.stable=new StableRole(2,{now});this.current=null;this.active=false;this.nextIntervalMs=3000;this.errorReported=false;this.running=false;this.timer=null;this.inFlight=null;this.generation=0;
 }
 emit(value,active=false){
  const changed=this.active!==active||JSON.stringify(this.current)!==JSON.stringify(value);
  this.current=value;this.active=active;if(changed)this.onChange(value,active);
 }
 hide(){this.nextIntervalMs=3000;this.generation++;this.stable.reset();this.emit(null,false);}
 sample(){
  if(this.inFlight)return this.inFlight;
  this.inFlight=this._sample().finally(()=>{this.inFlight=null;});return this.inFlight;
 }
 async _sample(){
  const generation=this.generation;
  try{
   const frame=await this.capture();
   if(generation!==this.generation)return;
   if(!frame){this.hide();this.errorReported=false;return;}
   const rect=frame.rect||cropRect(frame.imageWidth,frame.imageHeight,frame.displayWidth,frame.displayHeight);
   if(!rect){this.hide();this.errorReported=false;return;}
   this.emit(this.current,true);
   const text=await this.ocr(frame.image,rect);
   if(generation!==this.generation)return;
   const title=frame.titleImage?await this.ocr(frame.titleImage,frame.titleRect):'';
   if(generation!==this.generation)return;
   this.nextIntervalMs=String(text||title||'').trim()?this.intervalMs:3000;
   const mods=this.getMods(),notes=this.getNotes();
   const names=[...ROLE_NAMES,...mods.map(mod=>mod.localizedCharacterName||mod.characterName).filter(Boolean)];
   const leftTexts=[text],rightTexts=title?[title]:[];
   let candidate=resolveScreenRoleEvidence(leftTexts,rightTexts,names);
   if(!candidate&&frame.getFallbackImages){
    for(const fallback of frame.getFallbackImages()){
     const result=await this.ocr(fallback.image,fallback.rect);
     if(generation!==this.generation)return;
     (fallback.side==='left'?leftTexts:rightTexts).push(result);
     candidate=resolveScreenRoleEvidence(leftTexts,rightTexts,names);
     if(candidate)break;
    }
   }
   if(!candidate&&frame.getGlyphImage){
    const character=this.matchGlyph(frame.getGlyphImage());
    if(character)candidate={character,strong:false};
   }
   const selected=this.stable.observe(candidate?.character||null,candidate?.strong);
   this.emit(selected?(matchEnabledMods('/'+selected,mods,notes,{exact:true})||{character:selected,mods:[]}):null,true);
   this.errorReported=false;
  }catch(error){
   if(generation!==this.generation)return;
   if(!this.errorReported){this.errorReported=true;this.onError(error);}
  }
 }
 start(){
  if(this.running)return;this.running=true;
  const tick=async()=>{await this.sample();if(this.running)this.timer=setTimeout(tick,this.nextIntervalMs);};
  this.timer=setTimeout(tick,0);
 }
 async stop(){
  this.running=false;clearTimeout(this.timer);this.hide();if(this.inFlight)await this.inFlight;
 }
}

module.exports={GameHotkeyMonitor};
