'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('hoyoOverlay',{
 call:(action,payload={})=>ipcRenderer.invoke('hoyo:overlay',action,payload),
 onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('hoyo:overlay-state',listener);return()=>ipcRenderer.removeListener('hoyo:overlay-state',listener);}
});
