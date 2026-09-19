const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('hoyo',{
  call:async(action,payload={})=>{
    const result=await ipcRenderer.invoke('hoyo:call',action,payload);
    if(!result.ok)throw new Error(result.error);
    return result.value;
  },
  onDependency:callback=>{const listener=(_,v)=>callback(v);ipcRenderer.on('hoyo:dependency',listener);return()=>ipcRenderer.removeListener('hoyo:dependency',listener);},
  onAppUpdate:callback=>{const listener=(_,v)=>callback(v);ipcRenderer.on('hoyo:appUpdate',listener);return()=>ipcRenderer.removeListener('hoyo:appUpdate',listener);},
  onDownloads:callback=>{const listener=(_,v)=>callback(v);ipcRenderer.on('hoyo:downloads',listener);return()=>ipcRenderer.removeListener('hoyo:downloads',listener);},
  onProgress:callback=>{const listener=(_,v)=>callback(v);ipcRenderer.on('hoyo:progress',listener);return()=>ipcRenderer.removeListener('hoyo:progress',listener);},
  onState:callback=>{const listener=(_,v)=>callback(v);ipcRenderer.on('hoyo:state',listener);return()=>ipcRenderer.removeListener('hoyo:state',listener);},
  onNotifications:callback=>{const listener=(_,v)=>callback(v);ipcRenderer.on('hoyo:notifications',listener);return()=>ipcRenderer.removeListener('hoyo:notifications',listener);},
  // 后台任务的统一进度（检查更新、下载、更新、替换 Hash、软件更新）：任务卡据此渲染。
  onTasks:callback=>{const listener=(_,v)=>callback(v);ipcRenderer.on('hoyo:tasks',listener);return()=>ipcRenderer.removeListener('hoyo:tasks',listener);},
  // 3 秒即时通知：按钮点成功后的即时反馈，不进通知中心、不可点击。
  onToast:callback=>{const listener=(_,v)=>callback(v);ipcRenderer.on('hoyo:toast',listener);return()=>ipcRenderer.removeListener('hoyo:toast',listener);},
  onNotificationPopups:callback=>{const listener=(_,v)=>callback(v);ipcRenderer.on('hoyo:notification-popups',listener);return()=>ipcRenderer.removeListener('hoyo:notification-popups',listener);},
  // 后台检查更新的结果：界面据此缓存结果并点亮按钮红点，不会自动弹窗。
  onUpdateSummary:callback=>{const listener=(_,v)=>callback(v);ipcRenderer.on('hoyo:updateSummary',listener);return()=>ipcRenderer.removeListener('hoyo:updateSummary',listener);}
});
