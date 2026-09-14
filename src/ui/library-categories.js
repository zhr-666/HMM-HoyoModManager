'use strict';
// Project installed mods onto the source taxonomy without changing either input.
function buildLibraryTree(taxonomy,mods){
  const paths=new Map(),order=new Map();
  function index(nodes,parents=[]){
    for(const node of nodes){
      const path=[...parents,node];paths.set(String(node.id),path);order.set(String(node.id),order.size);
      index(node.children||[],path);
    }
  }
  index(taxonomy);
  const roots=[];
  for(const mod of mods){
    const leaf=String(mod.characterId||'unclassified');
    let path=paths.get(leaf);
    if(!path){
      const root=String(mod.rootCategoryId||(/^\d+$/.test(leaf)?'17510':'local'));
      path=paths.get(root)||[{id:root,name:mod.rootCategoryName||(root==='17510'?'Skins':'本地导入'),icon:''}];
      if(leaf!==root)path=[...path,{id:leaf,name:mod.characterName||'未分类',icon:''}];
    }
    let siblings=roots;
    for(const category of path){
      const id=String(category.id);
      let node=siblings.find(n=>n.id===id);
      if(!node){node={id,name:category.name,icon:category.icon||'',children:[],modIds:[]};siblings.push(node)}
      node.modIds.push(mod.id);siblings=node.children;
    }
  }
  function sort(nodes){
    nodes.sort((a,b)=>(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity));
    for(const node of nodes)sort(node.children);
  }
  sort(roots);
  return roots;
}
if(typeof module!=='undefined')module.exports={buildLibraryTree};
