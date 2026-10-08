// 头像：选图、压缩、显示
import { $, store, toast, escapeHtml } from './util.js';

// —— 头像 ——
/** 把用户选的图片居中裁成正方形、压缩成 128px JPEG（约 5~10KB） */
export function makeAvatar(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 128;
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(img,
        (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = URL.createObjectURL(file);
  });
}

/** 选图片 → 压缩 → 存本地，返回 data URL */
export function pickAvatar() {
  return new Promise((resolve) => {
    const input = $('#avatarFile');
    input.value = '';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      try {
        const dataUrl = await makeAvatar(file);
        store.set('gd_avatar', dataUrl);
        resolve(dataUrl);
      } catch (e) {
        toast(e.message);
        resolve(null);
      }
    };
    input.click();
  });
}

/** 头像 HTML：有图片用图片，机器人用 🤖，否则用名字首字 */
export function avatarHtml(src, name, { bot = false, team = null, cls = '' } = {}) {
  const t = team == null ? '' : ` team${team}`;
  if (src) return `<img class="avatar${t} ${cls}" src="${escapeHtml(src)}" alt="">`;
  const ch = bot ? '🤖' : escapeHtml(Array.from(String(name || '?').trim())[0] || '?');
  return `<span class="avatar letter${t} ${cls}">${ch}</span>`;
}
