'use strict';
// Retain decoded scenes for the current renderer. The hoyo:// responses still
// have no-store; this cache never survives an application restart or update.
function createBackgroundController({load,commit,update=()=>{},dispose=()=>{}}){
 const entries=new Map();let shown=null,desired=null,revision=0,operation=null;
 function prepare(scene){
  const existing=entries.get(scene.key);if(existing)return existing.promise;
  const record={game:scene.game,entry:null,promise:null};
  let loading;try{loading=load(scene);}catch(error){loading=Promise.reject(error);}
  record.promise=Promise.resolve(loading).then(entry=>{record.entry=entry;return entry;}).catch(error=>{if(entries.get(scene.key)===record)entries.delete(scene.key);throw error;});
  entries.set(scene.key,record);return record.promise;
 }
 function show(scene){
  if(desired===scene.key)return operation||Promise.resolve();
  desired=scene.key;const token=++revision;
  operation=prepare(scene).then(entry=>{
   if(token!==revision)return;
   if(shown!==scene.key){commit(entry);shown=scene.key;}
   for(const [key,record] of entries){
    if(record.game!==scene.game||key===scene.key)continue;
    entries.delete(key);record.promise.then(dispose).catch(()=>{});
   }
   if(entry.videoReady)entry.videoReady.then(()=>{if(token===revision&&shown===scene.key)update(entry);}).catch(()=>{});
  }).catch(error=>{if(token===revision)desired=null;throw error;});
  return operation;
 }
 return {prepare,show};
}
if(typeof module==='object'&&module.exports)module.exports={createBackgroundController};
else window.createBackgroundController=createBackgroundController;
