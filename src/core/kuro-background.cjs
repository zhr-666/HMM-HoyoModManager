const CONFIG_URL='https://prod-alicdn-gamestarter.kurogame.com/launcher/launcher/50004_obOHXFrFanqsaIEOmuKroCcbZkQRBC7c/G153/index.json';
const BASE_URL='https://prod-alicdn-gamestarter.kurogame.com/launcher/50004_obOHXFrFanqsaIEOmuKroCcbZkQRBC7c/G153/background/';

async function kuroBackgroundEntry(json){
  const config=await json(CONFIG_URL),hash=config?.functionCode?.background;
  if(typeof hash!=='string'||!/^[A-Za-z0-9]{32}$/.test(hash))throw Error('鸣潮官方背景配置无效。');
  const details=await json(`${BASE_URL}${hash}/zh-Hans.json`),image=details?.firstFrameImage;
  if(details?.functionSwitch!==1||typeof image!=='string'||!/^https:\/\/hw-pcdownload-qcloud\.aki-game\.net\/launcher\/clientUpload\/[A-Za-z0-9_-]+\.(?:webp|jpg|jpeg|png)$/.test(image))throw Error('鸣潮官方背景图片不可用。');
  // 库洛在启动器配置里提供多个等价 CDN；优先使用当前可用性较高的 AWS 节点。
  const aws='https://hw-pcdownload-aws.aki-game.net/';
  const poster=config?.default?.cdnList?.some(item=>item?.url===aws)?image.replace('https://hw-pcdownload-qcloud.aki-game.net/',aws):image;
  return {backgrounds:[{background:{url:poster}}]};
}

module.exports={kuroBackgroundEntry,CONFIG_URL};
