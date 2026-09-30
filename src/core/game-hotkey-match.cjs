'use strict';

// Screen labels may differ from GameBanana category names and need no category ID.
const SCREEN_ONLY_NAMES=['薇斯纳','起飞','尼可','沃雅妮莎'];
const SCREEN_ROLE_ALIASES={起飞:'荧',尼可:'尼可·莱恩'};
const ROLE_NAMES=[...Object.values(require('./character-names.zh-CN.json').genshin),...SCREEN_ONLY_NAMES];
const TITLE_CROP={x:1464,y:130,width:270,height:42};
const ROLE_CROP={x:215,y:28,width:190,height:36};

function parseRoleName(text){
 const compact=String(text||'').replace(/\s+/gu,'');
 return compact.match(/^[/／]([\p{Script=Han}·]{1,12})/u)?.[1]||'';
}

function matchEnabledMods(text,mods,hotkeyNotes={}, {exact=false}={}){
 const recognized=parseRoleName(text);
 if(!recognized)return null;
 const rows=Array.isArray(mods)?mods:[];
 const names=[...new Set(rows.map(mod=>String(mod.localizedCharacterName||mod.characterName||'').replace(/\s+/gu,'')))].filter(Boolean).sort((a,b)=>b.length-a.length);
 const character=names.find(name=>exact?(recognized===name||SCREEN_ROLE_ALIASES[recognized]===name):recognized.startsWith(name));
 if(!character)return null;
 const nameOf=mod=>String(mod.localizedCharacterName||mod.characterName||'').replace(/\s+/gu,'');
 const groups=new Set(rows.filter(mod=>nameOf(mod)===character&&mod.characterGroupId!=null&&String(mod.characterGroupId).trim()).map(mod=>String(mod.characterGroupId)));
 const matched=[];
 for(const mod of rows){
  const sameName=nameOf(mod)===character;
  const sameGroup=mod.isSkinMod===true&&mod.characterGroupId!=null&&groups.has(String(mod.characterGroupId));
  if(mod.active!==true||!sameName&&!sameGroup)continue;
  const bindings=(mod.hotkeys?.bindings||[]).filter(row=>!row.disabled&&(row.keys?.length||row.back?.length));
  const notes=(Array.isArray(hotkeyNotes?.[mod.id])?hotkeyNotes[mod.id]:[]).map(note=>typeof note==='string'?note:note?.text).filter(Boolean);
  if(bindings.length||notes.length)matched.push({id:mod.id,name:mod.name,bindings,notes});
 }
 return matched.length?{character:SCREEN_ROLE_ALIASES[recognized]?recognized:character,mods:matched}:null;
}

function cropRect(imageWidth,imageHeight,displayWidth,displayHeight,region=ROLE_CROP){
 if(![imageWidth,imageHeight,displayWidth,displayHeight].every(Number.isFinite))return null;
 if(displayWidth<1900||displayWidth>1940||displayHeight<1060||displayHeight>1100)return null;
 if(imageWidth<1||imageHeight<1)return null;
 const x=Math.round(region.x*imageWidth/1920),y=Math.round(region.y*imageHeight/1080);
 const width=Math.round(region.width*imageWidth/1920),height=Math.round(region.height*imageHeight/1080);
 if(x+width>imageWidth||y+height>imageHeight)return null;
 return {x,y,width,height};
}


// Fuzzy recovery is deliberately limited to one internal glyph. Both independent
// title regions must support the same unique catalog name; two-letter names never guess.
function resolveScreenRole(text,title='',names=ROLE_NAMES){
 const left=parseRoleName(text),right=String(title||'').replace(/[^\p{Script=Han}·]/gu,'');
 const catalog=[...new Set(names)].filter(Boolean);
 const candidates=value=>catalog.includes(value)?[value]:catalog.filter(name=>{
  if(value===name)return true;
  if(value.length!==name.length||name.length<3||value[0]!==name[0]||value.at(-1)!==name.at(-1))return false;
  return [...name].filter((char,index)=>char!==value[index]).length===1;
 });
 if(left&&right){
  const a=candidates(left),b=candidates(right),shared=a.filter(name=>b.includes(name));
  if(a.length>1||b.length>1)return null;
  if(!b.length&&catalog.includes(left))return {character:left,strong:false};
  if(!a.length&&catalog.includes(right))return {character:right,strong:false};
  if(shared.length!==1)return null;
  return {character:shared[0],strong:left===shared[0]&&right===shared[0]};
 }
 const exact=catalog.find(name=>name===(left||right));
 return exact?{character:exact,strong:false}:null;
}

function editDistance(a,b){
 const before=Array.from({length:b.length+1},(_,index)=>index);
 for(let i=1;i<=a.length;i++){
  let diagonal=before[0];before[0]=i;
  for(let j=1;j<=b.length;j++){
   const above=before[j];
   before[j]=Math.min(before[j]+1,before[j-1]+1,diagonal+(a[i-1]===b[j-1]?0:1));
   diagonal=above;
  }
 }
 return before[b.length];
}

function resolveScreenRoleEvidence(leftTexts,rightTexts,names=ROLE_NAMES){
 const catalog=[...new Set(names)].filter(name=>/^[\p{Script=Han}·]+$/u.test(name));
 const left=leftTexts.flatMap(value=>[parseRoleName(value),parseRoleName(String(value||'').split(/\s{2,}/u)[0])]).filter(Boolean);
 const right=rightTexts.map(value=>String(value||'').replace(/[^\p{Script=Han}·]/gu,'')).filter(Boolean);
 const exact=[...new Set([...left,...right].filter(value=>catalog.includes(value)))];
 if(exact.length>1)return null;
 if(exact.length===1){
  const character=exact[0];
  return {character,strong:left.includes(character)&&right.includes(character)};
 }
 const candidates=value=>{
  let matches=[];
  if(value.length===1){
   matches=catalog.filter(name=>name.length===2&&name.startsWith(value));
   if(matches.length!==1)matches=catalog.filter(name=>name.length===2&&name.endsWith(value));
  }else if(value.length>=2){
   matches=catalog.filter(name=>name.length>=3&&editDistance(value,name)===1&&(value[0]===name[0]||value.at(-1)===name.at(-1)));
   if(!matches.length&&value.length===2)matches=catalog.filter(name=>name.length===2&&name[0]===value[0]);
  }
  return matches.length===1?matches:[];
 };
 const possibleLeft=[...new Set(left.flatMap(candidates))],possibleRight=[...new Set(right.flatMap(candidates))];
 const shared=possibleLeft.filter(name=>possibleRight.includes(name));
 if(shared.length===1&&shared[0].length===2&&!([...left,...right].includes(shared[0][0])||[...left,...right].includes(shared[0][1])))return null;
 return shared.length===1?{character:shared[0],strong:false}:null;
}

class StableRole{
 constructor(threshold=2,{now=Date.now,missGraceMs=6000}={}){Object.assign(this,{threshold,now,missGraceMs});this.reset();}
 reset(){this.visible=null;this.pending=null;this.count=0;this.lastSeen=0;return null;}
 observe(name,strong=false){
  if(!name){this.pending=null;this.count=0;if(this.now()-this.lastSeen>=this.missGraceMs)this.visible=null;return this.visible;}
  this.lastSeen=this.now();
  if(name===this.visible){this.pending=null;this.count=0;return this.visible;}
  if(name!==this.pending){this.pending=name;this.count=1;}else this.count++;
  if(strong||this.count>=this.threshold){this.visible=name;this.pending=null;this.count=0;}
  return this.visible;
 }
}

module.exports={resolveScreenRole,resolveScreenRoleEvidence,ROLE_NAMES,TITLE_CROP,ROLE_CROP,parseRoleName,matchEnabledMods,cropRect,StableRole};
