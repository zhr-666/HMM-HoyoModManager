'use strict';
const path=require('node:path');
const {cropRect,TITLE_CROP,ROLE_CROP}=require('./game-hotkey-match.cjs');

function prepareRoleTitle(image,nativeImage){
 const {width,height}=image.getSize(),pixels=image.toBitmap();
 for(let i=0;i<pixels.length;i+=4){
  const b=pixels[i],g=pixels[i+1],r=pixels[i+2];
  const ink=Math.min(r,g,b)>=160&&Math.max(r,g,b)-Math.min(r,g,b)<65;
  pixels[i]=pixels[i+1]=pixels[i+2]=ink?0:255;pixels[i+3]=255;
 }
 return nativeImage.createFromBitmap(pixels,{width,height}).resize({width:width*3,height:height*3,quality:'best'});
}

function resizeRoleTitle(image){
 const {width,height}=image.getSize();
 return image.resize({width:width*2,height:height*2,quality:'best'});
}

function prepareGoldTitle(image,nativeImage){
 const {width,height}=image.getSize(),pixels=image.toBitmap();
 for(let i=0;i<pixels.length;i+=4){
  const b=pixels[i],g=pixels[i+1],r=pixels[i+2];
  const ink=r>=170&&g>=130&&r>b+35;
  pixels[i]=pixels[i+1]=pixels[i+2]=ink?0:255;pixels[i+3]=255;
 }
 return nativeImage.createFromBitmap(pixels,{width,height}).resize({width:width*3,height:height*3,quality:'best'});
}

const executablePath=file=>path.win32.normalize(String(file||'')).toLowerCase();
const isGame=(process,targetExe)=>Boolean(targetExe)&&executablePath(process?.file)===executablePath(targetExe);

class GameScreenCapture{
 constructor({host,desktopCapturer,screen,prepareTitle=image=>prepareRoleTitle(image,require('electron').nativeImage)}){
  Object.assign(this,{host,desktopCapturer,screen,prepareTitle});
 }
 async capture(targetExe){
  if(!targetExe)return null;
  const display=this.screen.getPrimaryDisplay();
  const displayWidth=Math.round(display.bounds.width*display.scaleFactor);
  const displayHeight=Math.round(display.bounds.height*display.scaleFactor);
  if(displayWidth<1900||displayWidth>1940||displayHeight<1060||displayHeight>1100)return null;
  const foreground=await this.host.request('foreground');
  if(!isGame(foreground,targetExe))return null;
  const sources=await this.desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1920,height:1080}});
  const source=sources.find(entry=>entry.display_id===String(display.id))||(sources.length===1?sources[0]:null);
  if(!source||source.thumbnail.isEmpty())throw Error('暂时无法取得游戏截图，将自动重试。');
  const {width:imageWidth,height:imageHeight}=source.thumbnail.getSize();
  const rect=cropRect(imageWidth,imageHeight,displayWidth,displayHeight);
  if(!rect)return null;
  const image=source.thumbnail.crop(rect).toPNG();
  const titleCrop=cropRect(imageWidth,imageHeight,displayWidth,displayHeight,TITLE_CROP);
  const rawTitle=source.thumbnail.crop(titleCrop);
  const alternate=(region,kind,side)=>{
   const cropped=source.thumbnail.crop(cropRect(imageWidth,imageHeight,displayWidth,displayHeight,region));
   const transformed=kind==='resize'?resizeRoleTitle(cropped):kind==='white'?this.prepareTitle(cropped):prepareGoldTitle(cropped,require('electron').nativeImage);
   const size=transformed.getSize();return {side,image:transformed.toPNG(),rect:{x:0,y:0,width:size.width,height:size.height}};
  };
  return {image,titleImage:rawTitle.toPNG(),titleRect:{x:0,y:0,width:titleCrop.width,height:titleCrop.height},getGlyphImage:()=>rawTitle.crop({x:0,y:0,width:42,height:42}).toPNG(),getFallbackImages:()=>[
   alternate(TITLE_CROP,'resize','right'),alternate(ROLE_CROP,'resize','left'),
   alternate(TITLE_CROP,'white','right'),alternate(ROLE_CROP,'gold','left'),
   alternate({x:190,y:20,width:280,height:55},'resize','left')
  ],rect:{x:0,y:0,width:rect.width,height:rect.height},imageWidth,imageHeight,displayWidth,displayHeight};
 }
}

module.exports={prepareRoleTitle,prepareGoldTitle,resizeRoleTitle,GameScreenCapture,isGame};
