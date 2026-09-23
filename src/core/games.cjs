// GameBanana category IDs and HoYoPlay business IDs are stable game identifiers.
const GAMES = Object.freeze([
  {id:'genshin',name:'原神',gameBananaId:8552,skinsCategoryId:17510,charactersCategoryId:18140,importer:'GIMI',icon:'genshin-icon.png',logo:'genshin-logo.png',background:'genshin-background.jpg',officialBackgroundId:'hk4e_cn'},
  {id:'zzz',name:'绝区零',gameBananaId:19567,skinsCategoryId:30305,charactersCategoryId:30305,importer:'ZZMI',icon:'zzz-icon.png',logo:'zzz-logo.svg',background:'zzz-background.jpg',officialBackgroundId:'nap_cn'},
  {id:'hsr',name:'崩坏：星穹铁道',gameBananaId:18366,skinsCategoryId:22633,charactersCategoryId:22832,importer:'SRMI',icon:'hsr-icon.png',logo:'hsr-logo.png',background:'hsr-background.jpg',officialBackgroundId:'hkrpg_cn'},
  {id:'wuwa',name:'鸣潮',gameBananaId:20357,skinsCategoryId:29524,charactersCategoryId:29524,importer:'WWMI',icon:'wuwa-icon.png',logo:'wuwa-logo.svg',background:'wuwa-background.jpg',officialBackgroundProvider:'kuro'}
].map(Object.freeze));
function getGame(id) {
  const game=GAMES.find(game=>game.id===id);
  if(!game)throw new Error('不支持的游戏。');
  return game;
}
module.exports={GAMES,getGame};
