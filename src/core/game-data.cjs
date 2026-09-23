const path=require('node:path');
const {getGame}=require('./games.cjs');
function gameRoot(root,id){return path.join(root,'games',getGame(id).id);}
function gameAtRoot(root){if(path.basename(path.dirname(root))!=='games')return null;try{return getGame(path.basename(root)).id}catch{return null}}
module.exports={gameRoot,gameAtRoot};
