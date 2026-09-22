// GameBanana category IDs and HoYoPlay business IDs are stable game identifiers.
const GAMES = Object.freeze([
  {id:'genshin',name:'原神',gameBananaId:8552,skinsCategoryId:17510,charactersCategoryId:18140,importer:'GIMI',icon:'genshin-icon.png',background:'home-background.jpg',officialBackgroundId:'hk4e_cn'},
  {id:'zzz',name:'绝区零',gameBananaId:19567,skinsCategoryId:30305,charactersCategoryId:30305,importer:'ZZMI',icon:'zzz-icon.png',background:'zzz-background.webp',officialBackgroundId:'nap_cn'},
  {id:'hsr',name:'崩坏：星穹铁道',gameBananaId:18366,skinsCategoryId:22633,charactersCategoryId:22832,importer:'SRMI',icon:'hsr-icon.png',background:'hsr-background.webp',officialBackgroundId:'hkrpg_cn'}
].map(Object.freeze));
function getGame(id) {
  const game=GAMES.find(game=>game.id===id);
  if(!game)throw new Error('不支持的游戏。');
  return game;
}
module.exports={GAMES,getGame};
