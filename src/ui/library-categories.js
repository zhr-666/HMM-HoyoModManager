'use strict';
// Project installed mods and registered empty folders onto the source taxonomy
// without changing either input.
function buildLibraryTree(taxonomy,mods,folders=[]){
  const paths=new Map(),order=new Map();
  function index(nodes,parents=[]){
    for(const node of nodes){
      const path=[...parents,node];paths.set(String(node.id),path);order.set(String(node.id),order.size);
      index(node.children||[],path);
    }
  }
  index(taxonomy);
  const roots=[];
  function resolve(path){
    let siblings=roots;
    const nodes=[];
    for(const category of path){
      const id=String(category.id);
      let node=siblings.find(n=>n.id===id);
      if(!node){node={id,name:category.name,icon:category.icon||'',children:[],modIds:[],directModIds:[]};siblings.push(node)}
      nodes.push(node);siblings=node.children;
    }
    return nodes;
  }
  function folderPath(folder){
    const known=paths.get(String(folder.id));
    if(known)return known;
    const rootId=String(folder.rootCategoryId||folder.id);
    const root={id:rootId,name:folder.rootCategoryName||folder.name||'未分类',icon:''};
    return rootId===String(folder.id)?[root]:[root,{id:String(folder.id),name:folder.name||'未分类',icon:''}];
  }
  // Folders the user created before any mod exists, so an empty character
  // folder still shows up in 我的模组.
  for(const folder of Array.isArray(folders)?folders:[]){
    if(!folder||folder.id===undefined)continue;
    resolve(folderPath(folder)).at(-1).folder=true;
  }
  for(const mod of mods){
    const leaf=String(mod.characterId||'unclassified');
    let path=paths.get(leaf);
    if(path===undefined&&mod.deploymentRelative!==undefined&&leaf.startsWith('local:')){let relative='';path=[{id:'local',name:'本地导入',icon:''},...mod.deploymentRelative.split('/').filter(Boolean).map(name=>{relative+=(relative?'/':'')+name;return {id:'local-folder:'+relative,name,icon:''};})];}
    if(!path){
      const root=String(mod.rootCategoryId||(/^\d+$/.test(leaf)?'17510':'local'));
      path=paths.get(root)||[{id:root,name:mod.rootCategoryName||(root==='17510'?'Skins':'本地导入'),icon:''}];
      if(leaf!==root)path=[...path,{id:leaf,name:mod.characterName||'未分类',icon:''}];
    }
    const nodes=resolve(path);
    for(const node of nodes)node.modIds.push(mod.id);
    nodes.at(-1).directModIds.push(mod.id);
  }
  function sort(nodes){
    nodes.sort((a,b)=>(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity));
    for(const node of nodes)sort(node.children);
  }
  sort(roots);
  return roots;
}
if(typeof module!=='undefined')module.exports={buildLibraryTree};
