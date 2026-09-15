const path=require('node:path'),fs=require('node:fs/promises'),{spawn}=require('node:child_process');
function externalSpec(file){if(typeof file!=='string'||!path.win32.isAbsolute(file)||!/[.]exe$/i.test(file)||file.includes('\0'))throw Error('请先选择要打开的 EXE 程序。');return {file,args:[]};}
async function open(file){
 const spec=externalSpec(file);if(process.platform!=='win32')throw Error('打开 EXE 程序需要在 Windows 上运行。');
 if(!(await fs.stat(file)).isFile())throw Error('指定程序不存在，请重新选择。');
 await new Promise((resolve,reject)=>{const child=spawn(spec.file,spec.args,{cwd:path.dirname(file),shell:false,detached:true,stdio:'ignore',windowsHide:false});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
 return {message:'已打开指定程序。'};
}
module.exports={externalSpec,open};
