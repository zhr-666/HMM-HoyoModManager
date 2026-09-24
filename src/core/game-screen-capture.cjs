'use strict';
const path=require('node:path');
const {cropRect}=require('./game-hotkey-match.cjs');

const GAME_EXECUTABLES=new Set(['genshinimpact.exe','yuanshen.exe']);
const isGame=p=>GAME_EXECUTABLES.has(path.win32.basename(String(p?.file||'')).toLowerCase());

class GameScreenCapture{
 constructor({host,desktopCapturer,screen,overlayFocused=()=>false}){
  Object.assign(this,{host,desktopCapturer,screen,overlayFocused});
 }
 async capture(){
  const display=this.screen.getPrimaryDisplay();
  const displayWidth=Math.round(display.bounds.width*display.scaleFactor);
  const displayHeight=Math.round(display.bounds.height*display.scaleFactor);
  if(displayWidth<1900||displayWidth>1940||displayHeight<1060||displayHeight>1100)return null;
  const scan=await this.host.request('scan');
  const gameProcesses=scan.processes.filter(isGame);
  if(!gameProcesses.length)return null;
  if(!gameProcesses.some(p=>p.pid===scan.foreground?.pid)&&!this.overlayFocused())return null;
  const sources=await this.desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1920,height:1080}});
  const source=sources.find(entry=>entry.display_id===String(display.id))||(sources.length===1?sources[0]:null);
  if(!source||source.thumbnail.isEmpty())return null;
  const {width:imageWidth,height:imageHeight}=source.thumbnail.getSize();
  const rect=cropRect(imageWidth,imageHeight,displayWidth,displayHeight);
  if(!rect)return null;
  const image=source.thumbnail.crop(rect).toPNG();
  return {image,rect:{x:0,y:0,width:rect.width,height:rect.height},imageWidth,imageHeight,displayWidth,displayHeight};
 }
}

module.exports={GameScreenCapture,isGame};
