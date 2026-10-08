import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/persist.js';

test('持久化：未配置时不存', () => {
  assert.equal(createStore({}), null);
});

test('持久化：本地文件', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gd-')), 'rooms.json');
  const store = createStore({ DATA_FILE: file });
  assert.deepEqual(await store.load(), []);
  await store.save([{ id: 'ABC' }]);
  assert.deepEqual(await store.load(), [{ id: 'ABC' }]);
});

test('持久化：Upstash REST（用本地假服务器）', async () => {
  const kv = new Map();
  let auth = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      auth = req.headers.authorization;
      const [cmd, key, value] = JSON.parse(body);
      let result = null;
      if (cmd === 'SET') { kv.set(key, value); result = 'OK'; }
      if (cmd === 'GET') result = kv.get(key) ?? null;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ result }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  const store = createStore({ UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${server.address().port}`, UPSTASH_REDIS_REST_TOKEN: 't0k' });
  assert.deepEqual(await store.load(), []);
  await store.save([{ id: 'XYZ', seats: [] }]);
  assert.deepEqual(await store.load(), [{ id: 'XYZ', seats: [] }]);
  assert.equal(auth, 'Bearer t0k');
  server.close();
});
