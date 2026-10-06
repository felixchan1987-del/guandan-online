// 头像：浏览器端已裁剪压缩成小 JPEG，这里校验后存在内存里，按内容哈希提供短网址
// 服务重启后丢失也没关系，客户端在每次连接时会重新上传
import crypto from 'node:crypto';

const MAX_BYTES = 40 * 1024;
const MAX_COUNT = 1000;
const store = new Map(); // id -> Buffer（Map 保持插入顺序，用作简单 LRU）

/** 保存 data URL 形式的 JPEG，成功返回 '/avatar/<id>.jpg'，否则 null */
export function putAvatar(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_BYTES || buf.length < 100) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null; // JPEG 文件头
  const id = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 20);
  store.delete(id);
  store.set(id, buf);
  if (store.size > MAX_COUNT) store.delete(store.keys().next().value);
  return `/avatar/${id}.jpg`;
}

export function getAvatar(id) {
  return store.get(id) || null;
}
