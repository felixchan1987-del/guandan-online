// 房间持久化：重启 / 重新部署后恢复进行中的房间（可选）
// - 设置 UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN：存到 Upstash Redis（免费额度够用，适合 Render 免费版）
// - 设置 DATA_FILE：存到本地 JSON 文件（自建服务器或挂了磁盘时）
// - 都不设：不持久化
import fs from 'node:fs';

const KEY = 'guandan:rooms';

export function createStore(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const cmd = async (args) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      if (!res.ok) throw new Error(`Upstash ${res.status}`);
      return (await res.json()).result;
    };
    return {
      name: 'Upstash Redis',
      intervalMs: 30 * 1000, // 免费额度按命令数计，30 秒最多存一次
      async load() { const v = await cmd(['GET', KEY]); return v ? JSON.parse(v) : []; },
      // 7 天没更新就自动过期
      async save(rooms) { await cmd(['SET', KEY, JSON.stringify(rooms), 'EX', String(7 * 24 * 3600)]); },
    };
  }
  const file = env.DATA_FILE;
  if (file) {
    return {
      name: file,
      intervalMs: 10 * 1000,
      async load() { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []; },
      async save(rooms) {
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(rooms));
        fs.renameSync(tmp, file);
      },
    };
  }
  return null;
}
