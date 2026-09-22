const fs=require('node:fs/promises');
const path=require('node:path');
const {AsyncLocalStorage}=require('node:async_hooks');
const {randomUUID}=require('node:crypto');
const Library=require('./library.cjs');
const {GAMES}=require('./games.cjs');
const GAME_KEYS=new Set(['modsPath','launchExe','secondaryExe','programTabs','backgroundVersion','xxmiPath','autoBackground']);

// Resolve existing ancestors too: a newly chosen directory may not exist yet.
async function canonical(value){
  let current=path.resolve(value),tail=[];
  for(;;){
    try{return path.join(await fs.realpath(current),...tail).toLowerCase();}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      const parent=path.dirname(current);
      if(parent===current)throw error;
      tail.unshift(path.basename(current));current=parent;
    }
  }
}
function overlaps(a,b){
  const within=(parent,child)=>{const relative=path.relative(parent,child);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
  return within(a,b)||within(b,a);
}

class Workspaces {
  constructor(root){
    if(!path.isAbsolute(root))throw new Error('数据目录必须是绝对路径');
    this.root=path.resolve(root);this.contexts=new Map();this.activeGameId='genshin';
    this.storage=new AsyncLocalStorage();this.queue=Promise.resolve();
    this.file=path.join(this.root,'workspaces.json');this.corrupt=false;
  }
  async init(){
    for(const game of GAMES){
      const root=game.id==='genshin'?this.root:path.join(this.root,'games',game.id);
      const ctx={game,root,lib:null,api:null,installer:null,downloadQueue:null,downloadReporter:null,busy:false,hashPreview:null,lastUpdateSummary:null,legacyDownloads:[],checkAbort:new AbortController()};
      ctx.lib=new Library(root,{
        gameId:game.id,libraryRoot:game.id==='genshin'?path.join(this.root,'library'):path.join(this.root,'library',game.id),
        previewRoot:this.root,dataRoot:this.root,getGlobalSettings:()=>this.getGlobalSettings(),
        resolveTaxonomy:()=>ctx.api.taxonomy(),validateModsPath:value=>this.validateModsPath(game.id,value),
      });
      this.contexts.set(game.id,ctx);
    }
    for(const ctx of this.contexts.values())await ctx.lib.init();
    try{
      const saved=JSON.parse(await fs.readFile(this.file,'utf8'));
      if(this.contexts.has(saved?.activeGameId))this.activeGameId=saved.activeGameId;
    }catch(error){if(error instanceof SyntaxError)this.corrupt=true;else if(error.code!=='ENOENT')throw error;}
    return this;
  }
  get(id){const ctx=this.contexts.get(id);if(!ctx)throw new Error('未知的游戏。');return ctx;}
  get current(){return this.storage.getStore()||this.get(this.activeGameId);}
  run(idOrContext,fn){
    const ctx=typeof idOrContext==='string'?this.get(idOrContext):idOrContext;
    if(!ctx||this.contexts.get(ctx.game?.id)!==ctx)throw new Error('未知的游戏工作区。');
    return this.storage.run(ctx,fn);
  }
  _enqueue(fn){const result=this.queue.then(fn,fn);this.queue=result.catch(()=>{});return result;}
  select(id){
    this.get(id);
    return this._enqueue(async()=>{
      if(this.corrupt)throw new Error('游戏工作区记录损坏，请保留 workspaces.json 后修复；程序不会覆盖该文件。');
      const temp=this.file+'.tmp-'+randomUUID();
      try{await fs.writeFile(temp,JSON.stringify({activeGameId:id},null,2)+'\n');await fs.rename(temp,this.file);}
      catch(error){await fs.rm(temp,{force:true});throw error;}
      this.activeGameId=id;return this.get(id);
    });
  }
  getGlobalSettings(){
    return Object.fromEntries(Object.entries(this.contexts.get('genshin')?.lib.state.settings||{}).filter(([key])=>!GAME_KEYS.has(key)));
  }
  setSettings(gameId,patch){
    const ctx=this.get(gameId);
    return this._enqueue(async()=>{
      if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('设置内容不能为空');
      const global={},local={};
      for(const [key,value] of Object.entries(patch))(GAME_KEYS.has(key)?local:global)[key]=value;
      // Validate and save game paths first, so a rejected path cannot change global preferences.
      if(Object.keys(local).length)await ctx.lib.settings(local,{gameId});
      if(Object.keys(global).length)await this.get('genshin').lib.settings(global);
      return ctx.lib.snapshot();
    });
  }
  async validateModsPath(gameId,value){
    if(!value)return;
    if(!path.isAbsolute(value))throw new Error('Mod 路径必须是绝对路径');
    const resolved=await canonical(value);
    const dataRoot=await canonical(this.root);
    if(overlaps(resolved,dataRoot)){
      // Bundled launchers install inside data/components. Only the matching
      // importer's real Mods directory may be used; aliases into library fail
      // this canonical path check before any deployment can touch them.
      const pieces=path.relative(dataRoot,resolved).split(path.sep);
      const bundled=pieces.length>=4&&pieces[0]==='components'&&/^xxmi-[0-9a-f]{12}$/.test(pieces[1])&&
        pieces.at(-2)===this.get(gameId).game.importer.toLowerCase()&&pieces.at(-1)==='mods';
      let loader=false;
      if(bundled){
        try{loader=(await fs.stat(path.join(path.dirname(value),'d3dx.ini'))).isFile();}
        catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}
      }
      if(!loader)throw new Error('启用库不能与程序数据目录交叉或重叠');
    }
    for(const ctx of this.contexts.values()){
      if(ctx.game.id===gameId)continue;
      const other=ctx.lib.effectiveSettings().modsPath;
      if(other&&overlaps(resolved,await canonical(other)))throw new Error(`启用库不能与${ctx.game.name}的启用库相同或相互嵌套`);
    }
  }
}
module.exports=Workspaces;
module.exports.Workspaces=Workspaces;
