'use strict';

const ROLE_CROP={x:215,y:28,width:190,height:36};

function parseRoleName(text){
 const compact=String(text||'').replace(/\s+/gu,'');
 return compact.match(/^[/／]([\p{Script=Han}·]{1,12})/u)?.[1]||'';
}

function matchEnabledMods(text,mods,hotkeyNotes={}){
 const recognized=parseRoleName(text);
 if(!recognized)return null;
 const rows=Array.isArray(mods)?mods:[];
 const names=[...new Set(rows.map(mod=>String(mod.localizedCharacterName||mod.characterName||'').replace(/\s+/gu,'')))].filter(Boolean).sort((a,b)=>b.length-a.length);
 const character=names.find(name=>recognized.startsWith(name));
 if(!character)return null;
 const matched=[];
 for(const mod of rows){
  if(mod.active!==true||String(mod.localizedCharacterName||mod.characterName||'').replace(/\s+/gu,'')!==character)continue;
  const bindings=(mod.hotkeys?.bindings||[]).filter(row=>!row.disabled&&(row.keys?.length||row.back?.length));
  const notes=(Array.isArray(hotkeyNotes?.[mod.id])?hotkeyNotes[mod.id]:[]).map(note=>typeof note==='string'?note:note?.text).filter(Boolean);
  if(bindings.length||notes.length)matched.push({id:mod.id,name:mod.name,bindings,notes});
 }
 return matched.length?{character,mods:matched}:null;
}

function cropRect(imageWidth,imageHeight,displayWidth,displayHeight){
 if(![imageWidth,imageHeight,displayWidth,displayHeight].every(Number.isFinite))return null;
 if(displayWidth<1900||displayWidth>1940||displayHeight<1060||displayHeight>1100)return null;
 if(imageWidth<1||imageHeight<1)return null;
 const x=Math.round(ROLE_CROP.x*imageWidth/1920),y=Math.round(ROLE_CROP.y*imageHeight/1080);
 const width=Math.round(ROLE_CROP.width*imageWidth/1920),height=Math.round(ROLE_CROP.height*imageHeight/1080);
 if(x+width>imageWidth||y+height>imageHeight)return null;
 return {x,y,width,height};
}

class StableRole{
 constructor(threshold=2){this.threshold=threshold;this.reset();}
 reset(){this.visible=null;this.pending=null;this.count=0;this.misses=0;return null;}
 observe(name){
  if(!name){this.pending=null;this.count=0;if(++this.misses>=this.threshold)this.visible=null;return this.visible;}
  this.misses=0;
  if(name===this.visible){this.pending=null;this.count=0;return this.visible;}
  if(name!==this.pending){this.pending=name;this.count=1;}else this.count++;
  if(this.count>=this.threshold){this.visible=name;this.pending=null;this.count=0;}
  return this.visible;
 }
}

module.exports={parseRoleName,matchEnabledMods,cropRect,StableRole};
