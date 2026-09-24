const fs=require('node:fs/promises');
const sync=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {gameRoot}=require('./game-data.cjs');
class Backgrounds{
  constructor(root){this.root=root;this.queues=new Map();}
  folder(game){return path.join(gameRoot(this.root,game),'backgrounds');}
  read(game){try{const m=JSON.parse(sync.readFileSync(path.join(this.folder(game),'current.json'),'utf8'));if(!/^[0-9a-f-]{36}$/.test(m.version)||!['image','video'].includes(m.kind)||(m.videoFormat&&!['webm','mp4'].includes(m.videoFormat)))return null;return m;}catch{return null;}}
  file(game,video=false){const m=this.read(game);return m?path.join(this.folder(game),m.version,video?`video.${m.videoFormat||'webm'}`:'poster'):null;}
  run(game,fn){const next=(this.queues.get(game)||Promise.resolve()).then(fn);this.queues.set(game,next.catch(()=>{}));return next;}
  update(game,entry,download){return this.run(game,async()=>{
    const row=entry?.backgrounds?.find(r=>r?.background?.url);if(!row)throw Error('官方暂未提供可用背景');
    const poster=row.background.url,video=row.video?.url||'',source=JSON.stringify([poster,video]),old=this.read(game);
    const videoFormat=video&&/\.mp4(?:\?|$)/i.test(video)?'mp4':'webm';
    if(old?.source===source&&sync.existsSync(this.file(game))&&(!video||sync.existsSync(this.file(game,true))))return old;
    return this.publish(game,{source,kind:video?'video':'image',...(video?{videoFormat}:{})},async dir=>{await download(poster,path.join(dir,'poster'));if(video)await download(video,path.join(dir,`video.${videoFormat}`));});
  });}
  custom(game,bytes){return this.run(game,()=>this.publish(game,{kind:'image',source:''},dir=>fs.writeFile(path.join(dir,'poster'),bytes)));}
  async publish(game,metadata,write){
    const folder=this.folder(game),version=randomUUID(),dir=path.join(folder,version),temp=path.join(folder,'current-'+version+'.tmp');
    await fs.mkdir(dir,{recursive:true});
    const record={...metadata,version};
    try{await write(dir);await fs.writeFile(temp,JSON.stringify(record));await fs.rename(temp,path.join(folder,'current.json'));}
    catch(error){await fs.rm(dir,{recursive:true,force:true});await fs.rm(temp,{force:true});throw error;}
    // The committed pointer always references complete files; old files are removed only afterwards.
    await this.cleanup(game,version);return record;
  }
  async cleanup(game,keep){
    const folder=this.folder(game);
    for(const name of await fs.readdir(folder).catch(()=>[]))if(/^[0-9a-f-]{36}$/.test(name)&&name!==keep)await fs.rm(path.join(folder,name),{recursive:true,force:true}).catch(()=>{});
  }
  reset(game){return this.run(game,async()=>{await fs.rm(path.join(this.folder(game),'current.json'),{force:true});await this.cleanup(game);});}
}
module.exports={Backgrounds};
