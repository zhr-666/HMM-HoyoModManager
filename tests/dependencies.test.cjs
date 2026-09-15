const test=require('node:test'),assert=require('node:assert/strict');
test('base GIMI and 3DMigoto requirements are ignored without hiding add-on mods',()=>{
 const {missing}=require('../src/core/dependencies.cjs');
 const base=['3DMigoto','3dmigoto v1.3.16','GIMI','3DMigoto (GIMI)','Genshin Impact Model Importer'].map(name=>({name}));
 base.push({name:'加载器',url:'https://github.com/SilentNightSound/GI-Model-Importer/releases'});
 const addons=[{name:'TexFx',sourceId:485763},{name:'GIMI Addon'},{name:'3DMigoto Fix'}];
 assert.deepEqual(missing([...base,...addons],[]),addons);
 assert.deepEqual(missing([...base,...addons],[],true),addons);
});
test('GameBanana official requirement tuples retain name and source identity',()=>{
 const {requirements}=require('../src/core/dependencies.cjs');
 assert.deepEqual(requirements([['TexFx','https://gamebanana.com/mods/485763'],['External','https://example.com/tool']]),[{name:'TexFx',url:'https://gamebanana.com/mods/485763',sourceId:485763},{name:'External',url:'https://example.com/tool',sourceId:null}]);
});
test('download presence uses source id even after rename, enable additionally checks active state',()=>{
 const {missing}=require('../src/core/dependencies.cjs');const req=[{name:'TexFx',sourceId:485763}],mods=[{name:'我的前置',sourceId:485763,active:false}];
 assert.equal(missing(req,mods,false).length,0);assert.equal(missing(req,mods,true).length,1);
 assert.equal(missing(req,[{name:'TexFx',sourceId:999,active:true}],false).length,1);
});
test('INI dependency scan recognizes external namespaces but excludes namespace defined in same package',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const {scanLocal}=require('../src/core/dependencies.cjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-deps-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'a.ini'),'namespace = MyMod\nrun = CommandList\\TexFx\\Transparency\nrun = CommandList\\MyMod\\Toggle\n');
 assert.deepEqual((await scanLocal(dir)).map(x=>x.name),['TexFx']);
});
test('installed namespace providers resolve local references and exclude disabled paths on enable',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const {providers,missing}=require('../src/core/dependencies.cjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-provider-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'DISABLED TexFx'));await fs.writeFile(path.join(dir,'DISABLED TexFx','TexFx.ini'),'namespace = TexFx');
 const refs=[{name:'TexFx',sourceId:null}];assert.equal(missing(refs,[{provides:await providers(dir,false),active:true}],false).length,0);assert.equal(missing(refs,[{provides:await providers(dir,true),active:true}],true).length,1);
});
test('dependency inventory retains future source identity without inspecting mod sources',async()=>{
 const {inventory,missing}=require('../src/core/dependencies.cjs');
 const mod={id:'p',folder:'/missing-source',sourceId:123,active:false},req=[{name:'TexFx',sourceId:123}];
 assert.equal(missing(req,await inventory([mod],null),false).length,0);
 assert.equal(missing(req,await inventory([mod],null,{active:true}),true).length,1);
 assert.equal(missing(req,await inventory([{...mod,active:true}],null,{active:true}),true).length,0);
});
async function fixture(t){
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-scoped-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const gimi=path.join(root,'GIMI'),managed=path.join(gimi,'Mods','HoYoModManaged');
 async function put(relative,content=''){const file=path.join(root,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);return file;}
 return {fs,path,root,gimi,managed,put};
}
test('inventory uses only filenames below BufferValues and Other/Misc, not namespaces or other sources',async t=>{
 const {inventory,missing}=require('../src/core/dependencies.cjs'),f=await fixture(t);
 await f.put('GIMI/Mods/HoYoModManaged/BufferValues/nested/ORFix.ini','namespace = WrongNamespace');
 await f.put('GIMI/Mods/HoYoModManaged/Other/Misc/nested/TexFx.txt');
 await f.put('GIMI/Outside.ini','namespace = Outside');
 await f.put('GIMI/Mods/HoYoModManaged/Other/Unrelated.ini','namespace = Unrelated');
 await f.put('source/SourceOnly.ini','namespace = SourceOnly');
 const rows=await inventory([{folder:f.path.join(f.root,'source'),active:true}],f.gimi);
 const names=['RECOMMENDED - ORFix（check for updates）','TexFx','WrongNamespace','Outside','Unrelated','SourceOnly'];
 assert.deepEqual(missing(names.map(name=>({name,sourceId:555})),rows).map(r=>r.name),['WrongNamespace','Outside','Unrelated','SourceOnly']);
});
test('filename matching requires complete name boundaries in both directions',()=>{
 const {missing}=require('../src/core/dependencies.cjs');
 assert.equal(missing([{name:'ORFixapi'}],[{provides:['ORFix']}]).length,1);
 assert.equal(missing([{name:'ORFix'}],[{provides:['ORFixapi']}]).length,1);
 assert.equal(missing([{name:'RECOMMENDED - orfix (check updates)'}],[{provides:['ORFix']}]).length,0);
});
test('active scan skips disabled directories and files while presence scan includes them',async t=>{
 const {inventory,missing}=require('../src/core/dependencies.cjs'),f=await fixture(t);
 await f.put('GIMI/Mods/HoYoModManaged/BufferValues/DISABLED package/ORFix.ini');
 await f.put('GIMI/Mods/HoYoModManaged/Other/Misc/DISABLED TexFx.ini');
 const req=[{name:'ORFix'},{name:'DISABLED TexFx'}];
 assert.equal(missing(req,await inventory([],f.gimi)).length,0);
 assert.equal(missing(req,await inventory([],f.gimi,{active:true}),true).length,2);
});
test('inventory never follows symbolic links within or above allowed scan roots',async t=>{
 const {inventory,missing}=require('../src/core/dependencies.cjs'),f=await fixture(t);
 await f.put('outside/Escape.ini');await f.fs.mkdir(f.path.join(f.managed,'Other'),{recursive:true});
 await f.fs.symlink(f.path.join(f.root,'outside'),f.path.join(f.managed,'BufferValues'),'dir');
 await f.fs.mkdir(f.path.join(f.managed,'Other','Misc'));
 await f.fs.symlink(f.path.join(f.root,'outside'),f.path.join(f.managed,'Other','Misc','link'),'dir');
 assert.equal(missing([{name:'Escape'}],await inventory([],f.gimi)).length,1);
 await f.fs.rm(f.managed,{recursive:true});await f.fs.mkdir(f.path.join(f.root,'outside','BufferValues'));
 await f.fs.writeFile(f.path.join(f.root,'outside','BufferValues','Escape.ini'),'');
 await f.fs.symlink(f.path.join(f.root,'outside'),f.managed,'dir');
 assert.equal(missing([{name:'Escape'}],await inventory([],f.gimi)).length,1);
});
test('filename inventory does not read file content and bounds directory depth',async t=>{
 const {inventory,missing}=require('../src/core/dependencies.cjs'),f=await fixture(t);
 await f.put('GIMI/Mods/HoYoModManaged/BufferValues/ORFix.ini','namespace = NotTheFilename');
 await f.put(`GIMI/Mods/HoYoModManaged/BufferValues/${'nested/'.repeat(40)}TooDeep.ini`);
 const original=f.fs.readFile;f.fs.readFile=async()=>{throw Error('Inventory must not read file contents');};
 try{assert.deepEqual(missing([{name:'ORFix'},{name:'TooDeep'}],await inventory([],f.gimi)),[{name:'TooDeep'}]);}
 finally{f.fs.readFile=original;}
});
