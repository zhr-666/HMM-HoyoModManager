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
test('dependency inventory follows future preset state and excludes old managed deployment',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const {inventory,missing}=require('../src/core/dependencies.cjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-future-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const gimi=path.join(root,'GIMI'),source=path.join(root,'source');await fs.mkdir(path.join(gimi,'Mods','HoYoModManaged'),{recursive:true});await fs.mkdir(source);await fs.writeFile(path.join(source,'provider.ini'),'namespace = TexFx');await fs.writeFile(path.join(gimi,'Mods','HoYoModManaged','provider.ini'),'namespace = TexFx');
 const mod={id:'p',folder:source,active:false};const req=[{name:'TexFx',sourceId:null}];assert.equal(missing(req,await inventory([mod],gimi,{active:true,managedMods:[mod]}),true).length,1);
 assert.equal(missing(req,await inventory([{...mod,active:true}],gimi,{active:true,managedMods:[mod]}),true).length,0);
});
