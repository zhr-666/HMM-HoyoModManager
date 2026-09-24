'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

const DEFAULT_SETTINGS=Object.freeze({entrySize:96,fontSize:15,x:null,y:null});
const limit=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Math.round(Number(value)))):fallback;
const coordinate=value=>Number.isFinite(value)?Math.round(value):null;

function normalizeSettings(value={}){
 return {
  entrySize:limit(value.entrySize,DEFAULT_SETTINGS.entrySize,56,160),
  fontSize:limit(value.fontSize,DEFAULT_SETTINGS.fontSize,12,32),
  x:coordinate(value.x),y:coordinate(value.y)
 };
}

function clampEntry(position,size,area){
 const x=Math.max(area.x,Math.min(area.x+area.width-size,Math.round(position.x)));
 const y=Math.max(area.y,Math.min(area.y+area.height-size,Math.round(position.y)));
 return {x,y};
}

class OverlaySettings{
 constructor(root){this.file=path.join(root,'overlay.json');}
 async load(){try{return normalizeSettings(JSON.parse(await fs.readFile(this.file,'utf8')));}catch{return {...DEFAULT_SETTINGS};}}
 async save(value){
  const next=normalizeSettings(value),temporary=this.file+'.'+randomUUID()+'.tmp';
  await fs.mkdir(path.dirname(this.file),{recursive:true});
  try{await fs.writeFile(temporary,JSON.stringify(next));await fs.rename(temporary,this.file);}finally{await fs.rm(temporary,{force:true}).catch(()=>{});}
  return next;
 }
}

module.exports={OverlaySettings,normalizeSettings,clampEntry,DEFAULT_SETTINGS};
