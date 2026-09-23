const DEFAULT_SETTINGS=Object.freeze({ autoCheckAppUpdates:true, launchExe:'', secondaryExe:'', programTabs:false, backgroundVersion:'', libraryView:'list', autoEnable: false, autoUpdate: false, autoCheckUpdates: false, blurNsfw: true, useLinks: true, material:'mica', proxyMode:'system', proxyUrl:'', xxmiPath: '', modsPath: ''});
const GAME_SETTING_KEYS=['modsPath','launchExe','secondaryExe','programTabs','backgroundVersion','xxmiPath','autoBackground'];
function validateSettingsPatch(patch,{gameOnly=false}={}){
 if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('设置内容不能为空');
 patch={...patch};delete patch.theme;
 const allowed = new Set(gameOnly ? GAME_SETTING_KEYS : Object.keys(DEFAULT_SETTINGS));
 allowed.add('autoBackground');
 for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new Error(`未知设置项：${key}`);
 for(const k of ['launchExe','secondaryExe','backgroundVersion','modsPath','xxmiPath'])if(k in patch&&typeof patch[k]!=='string')throw Error('无效设置值');
 if('programTabs' in patch&&typeof patch.programTabs!=='boolean')throw Error('窗口标签页设置无效');
 if('autoBackground' in patch&&typeof patch.autoBackground!=='boolean')throw Error('自动更新背景设置无效');
 if('libraryView' in patch&&!['list','grid'].includes(patch.libraryView))throw Error('模组视图无效。');
 if('material' in patch&&!['mica','acrylic'].includes(patch.material))throw Error('窗口材质选项无效。');
 if('proxyMode' in patch&&!['system','manual'].includes(patch.proxyMode))throw Error('代理模式无效。');
 if('proxyUrl' in patch&&(typeof patch.proxyUrl!=='string'||patch.proxyUrl.length>300))throw Error('代理地址无效。');
 for (const key of ['autoEnable','autoUpdate','autoCheckUpdates','autoCheckAppUpdates','blurNsfw','useLinks']) if(key in patch && typeof patch[key]!=='boolean')throw new Error(`${key} 必须是布尔值`);
 return patch;
}
module.exports={DEFAULT_SETTINGS,GAME_SETTING_KEYS,validateSettingsPatch};
