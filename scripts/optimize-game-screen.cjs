'use strict';
// pnpm exec electron scripts/optimize-game-screen.cjs <截图目录或 ZIP> [--profile profile.json] [--labels labels.json] [--out 目录]
const {app,nativeImage}=require('electron');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const {path7za}=require('7zip-bin');
const {createGameOcr}=require('../src/core/game-ocr.cjs');
const {ROLE_NAMES,ROLE_CROP,TITLE_CROP,cropRect,resolveScreenRoleEvidence}=require('../src/core/game-hotkey-match.cjs');
const {prepareRoleTitle,prepareGoldTitle,resizeRoleTitle}=require('../src/core/game-screen-capture.cjs');
const {matchRoleGlyph}=require('../src/core/game-role-glyph.cjs');

const IMAGE=/\.(png|jpe?g|webp)$/iu;
const DEFAULT_PROFILE={game:'genshin',names:[...new Set(ROLE_NAMES)].filter(name=>/^[\p{Script=Han}·]+$/u.test(name)),left:ROLE_CROP,right:TITLE_CROP,reference:{width:1920,height:1080},minWidth:1800,minHeight:1000};

function parseArgs(args){
 if(!args.length)throw Error('用法：pnpm exec electron scripts/optimize-game-screen.cjs <截图目录或 ZIP> [--profile profile.json] [--labels labels.json] [--out 目录]');
 const result={input:path.resolve(args[0])};
 for(let i=1;i<args.length;i+=2){
  if(!['--profile','--labels','--out'].includes(args[i])||!args[i+1])throw Error(`未知或缺少参数：${args[i]}`);
  result[args[i].slice(2)]=path.resolve(args[i+1]);
 }
 return result;
}

function validateProfile(value){
 if(!value||!Array.isArray(value.names)||!value.names.length||!value.names.every(name=>typeof name==='string'&&name.trim())||!['left','right'].every(key=>{
  const r=value[key];return r&&[r.x,r.y,r.width,r.height].every(n=>Number.isInteger(n)&&n>=0)&&r.width>0&&r.height>0;
 }))throw Error('配置必须有 names 数组及 left/right 裁区。');
 const reference=value.reference||{width:1920,height:1080};
 if(![reference.width,reference.height].every(n=>Number.isInteger(n)&&n>0))throw Error('reference 尺寸无效。');
 return {...value,reference,minWidth:value.minWidth??reference.width*0.9,minHeight:value.minHeight??reference.height*0.9};
}

function archiveEntries(listing){
 const body=listing.split(/----------\r?\n/u)[1];
 if(!body)throw Error('无法读取 ZIP 文件列表。');
 const entries=[];
 for(const block of body.split(/\r?\n\r?\n/u)){
  const info=Object.fromEntries(block.split(/\r?\n/u).map(line=>{const index=line.indexOf(' = ');return index<0?[]:[line.slice(0,index),line.slice(index+3)];}).filter(row=>row.length));
  if(!info.Path)continue;
  const normalized=info.Path.replaceAll('\\','/');
  if(normalized.startsWith('/')||/^[A-Za-z]:/u.test(normalized)||normalized.split('/').includes('..')||normalized.includes(':')||info.Encrypted==='+'||/(?:^|\s)l[rwx-]{9}/u.test(info.Attributes||''))throw Error(`ZIP 包含不安全条目：${info.Path}`);
  const size=Number(info.Size);
  if(!Number.isSafeInteger(size)||size<0)throw Error(`ZIP 条目大小无效：${info.Path}`);
  entries.push({name:normalized,size,folder:info.Folder==='+'});
 }
 if(entries.length>5000||entries.reduce((sum,row)=>sum+row.size,0)>2*1024**3)throw Error('ZIP 截图数量或展开大小超出工具限制。');
 return entries;
}

async function imageFiles(root){
 const found=[];
 async function visit(folder){
  for(const entry of await fs.readdir(folder,{withFileTypes:true})){
   const file=path.join(folder,entry.name);
   if(entry.isSymbolicLink())throw Error(`截图目录含符号链接：${file}`);
   if(entry.isDirectory())await visit(file);
   else if(entry.isFile()&&IMAGE.test(entry.name))found.push(file);
  }
 }
 await visit(root);return found.sort((a,b)=>a.localeCompare(b,'zh-CN'));
}

async function withScreenshots(input,action){
 const stat=await fs.stat(input);
 if(stat.isDirectory())return action(await imageFiles(input),input);
 if(!/\.zip$/iu.test(input))throw Error('输入须为截图目录或 ZIP。');
 const {stdout}=await run(path7za,['l','-slt',input],{maxBuffer:8*1024*1024});
 const entries=archiveEntries(stdout);
 if(!entries.some(row=>!row.folder&&IMAGE.test(row.name)))throw Error('ZIP 中没有截图。');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'hoyomod-ocr-'));
 try{
  await run(path7za,['x','-y',`-o${temp}`,input],{maxBuffer:8*1024*1024});
  return await action(await imageFiles(temp),temp);
 }finally{await fs.rm(temp,{recursive:true,force:true});}
}

function scaledRect(size,region,reference){
 const rect={x:Math.round(region.x*size.width/reference.width),y:Math.round(region.y*size.height/reference.height),width:Math.round(region.width*size.width/reference.width),height:Math.round(region.height*size.height/reference.height)};
 return rect.x>=0&&rect.y>=0&&rect.width>0&&rect.height>0&&rect.x+rect.width<=size.width&&rect.y+rect.height<=size.height?rect:null;
}

function ocrImage(image){const size=image.getSize();return {image:image.toPNG(),rect:{x:0,y:0,width:size.width,height:size.height}};}
function textPreview(image){return `data:image/png;base64,${image.toPNG().toString('base64')}`;}

async function scanImage(file,relative,profile,ocr){
 const image=nativeImage.createFromPath(file),size=image.getSize();
 const base={file:relative,width:size.width,height:size.height,recognized:'',left:'',right:'',status:'未识别'};
 if(image.isEmpty()||size.width<profile.minWidth||size.height<profile.minHeight)return {...base,status:'跳过：尺寸不足'};
 const leftRect=scaledRect(size,profile.left,profile.reference),rightRect=scaledRect(size,profile.right,profile.reference);
 if(!leftRect||!rightRect)return {...base,status:'跳过：裁区越界'};
 const left=image.crop(leftRect),right=image.crop(rightRect),leftTexts=[],rightTexts=[];
 const start=performance.now();
 const read=async(crop,side)=>{
  const sample=ocrImage(crop),value=(await ocr.recognize(sample.image,sample.rect)).trim();
  (side==='left'?leftTexts:rightTexts).push(value);return value;
 };
 base.left=await read(left,'left');base.right=await read(right,'right');
 const resolve=()=>profile.game==='genshin'?resolveScreenRoleEvidence(leftTexts,rightTexts,profile.names):genericMatch(leftTexts,rightTexts,profile.names,profile.leftPrefix||'');
 let match=resolve();
 if(!match&&profile.game==='genshin'){
  for(const [crop,side] of [[resizeRoleTitle(right),'right'],[resizeRoleTitle(left),'left'],[prepareRoleTitle(right,nativeImage),'right'],[prepareGoldTitle(left,nativeImage),'left']]){
   await read(crop,side);match=resolve();if(match)break;
  }
  if(!match){
   const wide=scaledRect(size,{x:190,y:20,width:280,height:55},profile.reference);
   if(wide){await read(resizeRoleTitle(image.crop(wide)),'left');match=resolve();}
  }
  if(!match){
   const character=matchRoleGlyph(right.crop({x:0,y:0,width:42,height:42}).toPNG(),nativeImage);
   if(character)match={character,strong:false,glyph:true};
  }
 }
 base.recognized=match?.character||'';base.status=match?.glyph?'字形兜底':match?.strong?'双区域确认':match?'候选待复核':'未识别';
 base.milliseconds=Math.round(performance.now()-start);
 base.leftPreview=textPreview(left);base.rightPreview=textPreview(right);
 return base;
}

function genericMatch(left,right,names,prefix){
 const values=[...left,...right].map(text=>String(text||'').replace(/\s+/gu,'')).map(value=>prefix&&value.startsWith(prefix)?value.slice(prefix.length):value).filter(Boolean);
 const exact=[...new Set(values.filter(value=>names.includes(value)))];
 return exact.length===1?{character:exact[0],strong:values.filter(value=>value===exact[0]).length>1}:null;
}

function htmlReport(rows,profile){
 const data=JSON.stringify({rows,names:profile.names}).replaceAll('<','\\u003c');
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>游戏画面识别报告</title><style>body{font:15px system-ui;margin:24px;background:#f5f6f8;color:#242936}h1{margin:0 0 8px}.tip{color:#586174}table{border-collapse:collapse;width:100%;background:white}td,th{border:1px solid #d8dce3;padding:8px;text-align:left}img{display:block;max-width:240px;max-height:48px;background:#556b80}select{width:140px;padding:5px}button{padding:8px 14px;cursor:pointer}</style><h1>游戏画面识别报告</h1><p class="tip">对照两处标题选正确角色；文件名无需修改。选完点击“下载标注”，下次用 --labels 文件复测。</p><button id="save">下载标注 JSON</button><p id="summary"></p><table><thead><tr><th>截图</th><th>左上标题</th><th>右侧角色名</th><th>识别结果</th><th>正确角色</th></tr></thead><tbody id="rows"></tbody></table><script>const report=${data};const previous=report.rows;const root=document.querySelector('#rows');for(const row of previous){const tr=document.createElement('tr');for(const value of [row.file,row.leftPreview?'<img src="'+row.leftPreview+'">':'',row.rightPreview?'<img src="'+row.rightPreview+'">':'',row.recognized||row.status]){const td=document.createElement('td');if(value.startsWith('<img '))td.innerHTML=value;else td.textContent=value;tr.append(td)}const td=document.createElement('td'),select=document.createElement('select');select.dataset.file=row.file;for(const name of ['',...report.names]){const option=document.createElement('option');option.value=name;option.textContent=name||'请选择';select.append(option)}select.value=row.expected||'';td.append(select);tr.append(td);root.append(tr)}document.querySelector('#summary').textContent='截图 '+previous.length+' 张；已识别 '+previous.filter(row=>row.recognized).length+' 张。';document.querySelector('#save').onclick=()=>{const labels=Object.fromEntries([...document.querySelectorAll('select')].filter(node=>node.value).map(node=>[node.dataset.file,node.value]));const blob=new Blob([JSON.stringify(labels,null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='labels.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000)};</script></html>`;
}

async function main(args){
 const options=parseArgs(args),profile=validateProfile(options.profile?JSON.parse(await fs.readFile(options.profile,'utf8')):DEFAULT_PROFILE);
 const suppliedLabels=options.labels?JSON.parse(await fs.readFile(options.labels,'utf8')):{};
 const labels=Array.isArray(suppliedLabels)?Object.fromEntries(suppliedLabels.map(row=>[row.file,row.expected])):suppliedLabels;
 const out=options.out||path.resolve('test-results/game-screen-ocr-report');await fs.mkdir(out,{recursive:true});
 const ocr=createGameOcr({names:profile.names}),rows=[];
 try{
  await withScreenshots(options.input,async(files,root)=>{
   if(!files.length)throw Error('输入中没有可读取的截图。');
   for(const file of files){
    const relative=path.relative(root,file).replaceAll(path.sep,'/');
    const row=await scanImage(file,relative,profile,ocr);
    row.expected=labels[relative]||'';rows.push(row);
    console.log(`${rows.length}/${files.length} ${relative}: ${row.recognized||row.status}`);
   }
  });
 }finally{await ocr.close();}
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(rows.map(({leftPreview,rightPreview,...row})=>row),null,2));
 await fs.writeFile(path.join(out,'report.html'),htmlReport(rows,profile));
 const checked=rows.filter(row=>row.expected),correct=checked.filter(row=>row.recognized===row.expected).length,wrong=checked.filter(row=>row.recognized&&row.recognized!==row.expected).length;
 console.log(`报告：${path.join(out,'report.html')}；有效标注 ${checked.length}，正确 ${correct}，错认 ${wrong}，未识别 ${checked.length-correct-wrong}。`);
 return {rows,correct,wrong};
}

if(process.versions.electron)app.whenReady().then(()=>main(process.argv.slice(2))).then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1);});
module.exports={parseArgs,validateProfile,archiveEntries,scaledRect,genericMatch};
