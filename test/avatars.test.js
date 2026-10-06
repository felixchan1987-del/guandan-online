import { test } from 'node:test';
import assert from 'node:assert/strict';
import { putAvatar, getAvatar } from '../server/avatars.js';

const jpeg = (n, head = [0xff, 0xd8, 0xff]) => {
  const b = Buffer.alloc(n, 7);
  head.forEach((x, i) => { b[i] = x; });
  return `data:image/jpeg;base64,${b.toString('base64')}`;
};

test('头像：合法 JPEG 得到短网址，内容相同得到同一地址', () => {
  const url = putAvatar(jpeg(2000));
  assert.match(url, /^\/avatar\/[0-9a-f]{20}\.jpg$/);
  assert.equal(putAvatar(jpeg(2000)), url);
  assert.equal(getAvatar(url.slice(8, -4)).length, 2000);
});

test('头像：拒绝非 JPEG、过大、格式错误', () => {
  assert.equal(putAvatar(jpeg(2000, [0x89, 0x50, 0x4e])), null); // PNG 头
  assert.equal(putAvatar(jpeg(50 * 1024)), null);
  assert.equal(putAvatar('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(putAvatar('javascript:alert(1)'), null);
  assert.equal(putAvatar(null), null);
});
