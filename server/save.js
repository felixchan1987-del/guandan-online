// 对局存档码：服务器密钥加密（AES-256-GCM）+ 压缩
// 存档里有所有人的手牌，所以必须加密，拿到存档的人既看不到也改不了
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const PREFIX = 'GD1.';
const VERSION = 1;

let secret = process.env.SAVE_SECRET;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('未设置 SAVE_SECRET：服务重启后旧存档将无法读取');
}
const key = crypto.createHash('sha256').update(secret).digest();

export function encodeSave(data) {
  const plain = zlib.deflateRawSync(Buffer.from(JSON.stringify({ v: VERSION, ...data })));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** 解码失败返回 null */
export function decodeSave(code) {
  try {
    code = String(code || '').replace(/\s+/g, '');
    if (!code.startsWith(PREFIX)) return null;
    const buf = Buffer.from(code.slice(PREFIX.length), 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
    const data = JSON.parse(zlib.inflateRawSync(plain).toString());
    return data.v === VERSION ? data : null;
  } catch {
    return null;
  }
}
