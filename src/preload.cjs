const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('hoyo',{
  call:async(action,payload={})=>{
    const result=await ipcRenderer.invoke('hoyo:call',action,payload);
    if(!result.ok)throw new Error(result.error);
    return result.value;
  },
  onAppUpdate:callback=>{const listener=(_,v)=>callback(v);ipcRenderer.on('hoyo:appUpdate',listener);return()=>ipcRenderer.removeListener('hoyo:appUpdate',listener);},
  onDownloads:callback=>{const listener=(_,v)=>callback(v);ipcRenderer.on('hoyo:downloads',listener);return()=>ipcRenderer.removeListener('hoyo:downloads',listener);},
  onProgress:callback=>{const listener=(_,v)=>callback(v);ipcRenderer.on('hoyo:progress',listener);return()=>ipcRenderer.removeListener('hoyo:progress',listener);},
  onState:callback=>{const listener=(_,v)=>callback(v);ipcRenderer.on('hoyo:state',listener);return()=>ipcRenderer.removeListener('hoyo:state',listener);},
  onNotice:callback=>{const listener=(_,v)=>callback(v);ipcRenderer.on('hoyo:notice',listener);return()=>ipcRenderer.removeListener('hoyo:notice',listener);}
});
