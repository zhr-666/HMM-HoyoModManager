// GameBanana 分类 ID 是映射键。角色名与清楚可译的大分类共用这一份映射；
// 未核实的名称留在原文中，UI、缩写及专有名词不翻译。
const names=require('./character-names.zh-CN.json');

function translateCategory(gameId,id,original){
  return names[gameId]?.[String(id)]||original;
}

function localizeTaxonomy(gameId,nodes){
  return (nodes||[]).map(node=>({
    ...node,
    name:translateCategory(gameId,node.id,node.name),
    children:localizeTaxonomy(gameId,node.children)
  }));
}

// 只投影给界面，不写回安装记录。旧记录与手建分类也能离线显示中文，
// 原来的 libraryPath、真实文件夹和启用状态保持不变。
function localizeLibraryState(gameId,state){
  return {
    ...state,
    mods:(state.mods||[]).map(mod=>({...mod,characterName:translateCategory(gameId,mod.characterId,mod.characterName),rootCategoryName:translateCategory(gameId,mod.rootCategoryId,mod.rootCategoryName)})),
    folders:(state.folders||[]).map(folder=>({...folder,name:translateCategory(gameId,folder.id,folder.name),rootCategoryName:translateCategory(gameId,folder.rootCategoryId,folder.rootCategoryName)}))
  };
}

module.exports={translateCategory,localizeTaxonomy,localizeLibraryState};
