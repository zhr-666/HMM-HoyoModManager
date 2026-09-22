const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {getGame}=require('./games.cjs');
function proxyConfig(settings){
 if(settings.proxyMode!=='manual')return {mode:'system'};
 let url;try{url=new URL(settings.proxyUrl);}catch{throw Error('请输入代理地址，例如 http://127.0.0.1:7890。');}
 if(!['http:','socks5:'].includes(url.protocol)||!url.hostname||!url.port||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw Error('代理地址须为 http://主机:端口 或 socks5://主机:端口，不含账号、路径。');
 return {mode:'fixed_servers',proxyRules:url.protocol+'//'+url.host};
}
function materialSupported(platform=process.platform,release=os.release()){return platform==='win32'&&Number(release.split('.')[2])>=22621;}
async function requireMods(settings,gameId='genshin'){
 const game=getGame(gameId),dir=settings.modsPath;
 if(typeof dir!=='string'||!path.isAbsolute(dir))throw Error(`请先在设置中选择 ${game.importer} 文件夹，再下载或启用模组。`);
 try{
  if(!(await fs.stat(dir)).isDirectory())throw Error();
  if(path.basename(dir).toLowerCase()!=='mods')throw Error();
  if(!(await fs.stat(path.join(path.dirname(dir),'d3dx.ini'))).isFile())throw Error();
 }catch{throw Error(`${game.importer} 文件夹不可用或缺少 d3dx.ini，请在设置中重新选择。`);}
}

module.exports={proxyConfig,materialSupported,requireMods};
