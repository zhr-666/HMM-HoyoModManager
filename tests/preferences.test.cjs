const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {proxyConfig,materialSupported,requireMods}=require('../src/core/preferences.cjs');
test('proxy selection validates a single HTTP or SOCKS5 endpoint',()=>{
 assert.deepEqual(proxyConfig({proxyMode:'system'}),{mode:'system'});assert.equal(proxyConfig({proxyMode:'manual',proxyUrl:'http://127.0.0.1:7890'}).proxyRules,'http://127.0.0.1:7890');assert.equal(proxyConfig({proxyMode:'manual',proxyUrl:'socks5://127.0.0.1:1080'}).proxyRules,'socks5://127.0.0.1:1080');
 for(const proxyUrl of ['file:///tmp/proxy','http://name:pass@localhost:80','http://localhost:7890/path','bad'])assert.throws(()=>proxyConfig({proxyMode:'manual',proxyUrl}));
});
test('material support requires Windows 11 22H2 or later',()=>{assert.equal(materialSupported('win32','10.0.22621'),true);assert.equal(materialSupported('win32','10.0.19045'),false);assert.equal(materialSupported('darwin','25.6.0'),false);});
test('mod downloads require a selected existing GIMI Mods folder',async t=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-gimi-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await assert.rejects(requireMods({}),/选择/);await assert.rejects(requireMods({modsPath:root}),/d3dx.ini/);const modsPath=path.join(root,'Mods');await fs.mkdir(modsPath);await fs.writeFile(path.join(root,'d3dx.ini'),'[Include]');await requireMods({modsPath});});
