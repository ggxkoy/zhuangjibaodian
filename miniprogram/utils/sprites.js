// 立绘资源解析：控制主包体积（微信在 1.5MB 起提示、2MB 硬上限）。
// 主包只保留默认 boss.jpg 兜底，其余差分/角色立绘放云开发云存储：
//
// 1. 开发者工具 → 云开发控制台 → 存储 → 新建 sprites 目录，
//    把仓库 assets-remote/ 下的所有图上传进去；
// 2. 复制其中任意文件的 File ID（形如 cloud://环境ID.桶ID/sprites/boss-happy.jpg），
//    去掉文件名、保留到 /sprites，填进下面 REMOTE_BASE；
// 3. <image> 原生支持 cloud:// 地址，无需下载逻辑。
//
// REMOTE_BASE 留空时全部按主包本地路径解析：缺图走降级链回落 boss.jpg，
// 表现为"所有角色都用默认立绘"，功能不受影响。
const REMOTE_BASE = ''; // 例：'cloud://cloud1-xxx.636c-cloud1-xxx-1250000000/sprites'

const LOCAL_FILES = ['boss.jpg']; // 主包内实际打包的立绘

function spriteSrc(file) {
  if (LOCAL_FILES.indexOf(file) >= 0 || !REMOTE_BASE) return '/assets/' + file;
  return REMOTE_BASE + '/' + file;
}

module.exports = { spriteSrc };
