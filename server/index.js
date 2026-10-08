import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Game } from './game.js';
import { Room, TURN_CHOICES, SKILLS } from './room.js';
import { encodeSave, decodeSave } from './save.js';
import { putAvatar, getAvatar } from './avatars.js';
import { createStore } from './persist.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.env.PORT || 3000;
const ROOM_IDLE_MS = 30 * 60 * 1000;
const SEAT_GRACE_MS = 60 * 1000;
const OFFLINE_AUTO_MS = Number(process.env.OFFLINE_AUTO_MS || 8000); // 对局中掉线多久后托管（刷新页面不受影响）

const app = express();
app.use('/shared', express.static(path.join(root, 'shared')));
app.use(express.static(path.join(root, 'public')));
app.get('/avatar/:id.jpg', (req, res) => {
  const buf = getAvatar(req.params.id);
  if (!buf) return res.status(404).end();
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  res.send(buf);
});
// 健康检查 / 保活
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
// /r/房间号 直接进入房间页
app.get('/r/:roomId', (_req, res) => res.sendFile(path.join(root, 'public', 'index.html')));

const httpServer = createServer(app);
const io = new Server(httpServer);

/** roomId -> Room */
const rooms = new Map();
let dirty = false;

function changed(room) {
  room.syncBots();
  room.schedule();
  broadcast(room);
  dirty = true;
}

function getRoom(id) {
  let room = rooms.get(id);
  if (!room) {
    room = new Room(id, changed);
    rooms.set(id, room);
  }
  clearTimeout(room.idleTimer);
  return room;
}

function broadcast(room) {
  const seats = room.seats.map((s) => s && {
    name: s.name, avatar: s.avatar || null, bot: !!s.bot, online: !!s.bot || room.isOnline(s.playerId),
  });
  const spectators = [...room.members.values()]
    .filter((m) => room.seatOf(m.playerId) < 0)
    .map((m) => m.name);
  const { password, ...pub } = room.settings;
  for (const [socketId, m] of room.members) {
    const seat = room.seatOf(m.playerId);
    io.to(socketId).emit('state', {
      roomId: room.id,
      seats,
      spectators,
      mySeat: seat < 0 ? null : seat,
      paused: room.paused,
      loadedFrom: room.loadedFrom,
      deadline: room.deadline,
      turnMs: room.turnMs,
      // 密码只发给入座玩家（方便他们分享链接）
      settings: { ...pub, hasPassword: !!password, password: seat >= 0 ? password : undefined },
      serverNow: Date.now(),
      god: seat < 0 && !!m.god,
      game: room.game.view(seat < 0 ? null : seat, { god: seat < 0 && m.god }),
    });
  }
}

// —— 持久化（可选，见 persist.js） ——
const store = createStore();
let saving = false;
async function save() {
  if (!store || !dirty || saving) return;
  dirty = false;
  saving = true;
  try {
    await store.save([...rooms.values()]);
  } catch (e) {
    dirty = true;
    console.error('保存房间失败', e.message);
  } finally {
    saving = false;
  }
}

async function load() {
  if (!store) return;
  try {
    for (const data of await store.load()) {
      const room = Room.fromJSON(data, changed);
      rooms.set(room.id, room);
      room.schedule();
      room.idleTimer = setTimeout(() => deleteRoom(room), ROOM_IDLE_MS);
    }
    console.log(`已从 ${store.name} 恢复 ${rooms.size} 个房间`);
  } catch (e) {
    console.error('恢复房间失败', e.message);
  }
}

function deleteRoom(room) {
  if (room.members.size) return;
  room.dispose();
  rooms.delete(room.id);
  dirty = true;
}

if (store) {
  setInterval(save, store.intervalMs).unref();
  // 重新部署 / 停机前存一次
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, async () => { dirty = true; await save(); process.exit(0); });
  }
}

// —— 保活：Render 免费版 15 分钟没有访问会休眠，休眠会丢掉房间。
// 还有房间时每 10 分钟访问一次自己；房间都散了（空房间 30 分钟后清理）就让它休眠，不浪费免费时长
const SELF_URL = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL;
if (SELF_URL && process.env.KEEP_ALIVE !== '0') {
  setInterval(() => {
    if (rooms.size) fetch(`${SELF_URL.replace(/\/$/, '')}/healthz`).catch(() => {});
  }, 10 * 60 * 1000).unref();
}

const cleanName = (n) => String(n || '').trim().slice(0, 12) || '玩家';

io.on('connection', (socket) => {
  let room = null;
  let me = null;
  let lastChat = 0;

  const reply = (cb, result) => typeof cb === 'function' && cb(result);
  const mySeat = () => (room ? room.seatOf(me.playerId) : -1);
  /** 玩家操作的通用包装：校验座位、执行、成功后广播 */
  const act = (cb, fn) => {
    const seat = mySeat();
    if (seat < 0) return reply(cb, { ok: false, error: '观战者不能操作' });
    const r = fn(seat, room.game);
    reply(cb, r);
    if (r.ok) changed(room);
  };
  /** 对局内操作：暂停时不允许 */
  const playAct = (cb, fn) => act(cb, (seat, g) =>
    (room.paused ? { ok: false, error: '对局已暂停，点「继续」后再操作' } : fn(seat, g)));

  socket.on('join', ({ roomId, playerId, name, god, password } = {}, cb) => {
    roomId = String(roomId || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!roomId || !playerId) return reply(cb, { ok: false, error: '参数错误' });
    playerId = String(playerId).slice(0, 64);
    const target = rooms.get(roomId);
    // 有密码的房间：已入座的人（掉线重连）不用再输
    if (target?.settings.password && target.seatOf(playerId) < 0 && String(password || '') !== target.settings.password) {
      return reply(cb, { ok: false, needPassword: true, error: password ? '密码不对' : '这个房间需要密码' });
    }
    if (room && room.id !== roomId) room.members.delete(socket.id);
    room = getRoom(roomId);
    me = { playerId, name: cleanName(name), god: !!god, avatar: me?.avatar || null };
    room.members.set(socket.id, me);
    socket.join(roomId);
    const seat = mySeat();
    if (seat >= 0) {
      room.seats[seat].name = me.name;
      room.markOnline(seat);
    }
    reply(cb, { ok: true });
    socket.emit('chatHistory', room.chat);
    changed(room);
  });

  socket.on('sit', ({ seat } = {}, cb) => {
    if (!room) return;
    if (!room.seatsOpen) return reply(cb, { ok: false, error: '对局进行中，请先暂停再换座' });
    if (!(seat >= 0 && seat < 4) || room.seats[seat]) return reply(cb, { ok: false, error: '该座位已有人' });
    const cur = mySeat();
    if (cur >= 0) room.seats[cur] = null;
    room.seats[seat] = { playerId: me.playerId, name: me.name, avatar: me.avatar };
    reply(cb, { ok: true });
    changed(room);
  });

  socket.on('stand', (_, cb) => {
    if (!room) return;
    if (!room.seatsOpen) return reply(cb, { ok: false, error: '对局进行中，请先暂停再离座' });
    const cur = mySeat();
    if (cur >= 0) room.seats[cur] = null;
    reply(cb, { ok: true });
    changed(room);
  });

  // 机器人：仅限已入座玩家，开局前或暂停中
  socket.on('addBot', ({ seat } = {}, cb) => act(cb, () => {
    if (!room.seatsOpen) return { ok: false, error: '对局进行中，请先暂停再加机器人' };
    const targets = seat == null ? [0, 1, 2, 3].filter((i) => !room.seats[i]) : [seat];
    if (!targets.length || targets.some((i) => !(i >= 0 && i < 4) || room.seats[i])) {
      return { ok: false, error: '没有空位' };
    }
    targets.forEach((i) => room.addBot(i));
    return { ok: true };
  }));

  socket.on('removeBot', ({ seat } = {}, cb) => act(cb, () => {
    if (!room.seatsOpen) return { ok: false, error: '对局进行中，请先暂停再移除机器人' };
    if (!room.seats[seat]?.bot) return { ok: false, error: '该座位不是机器人' };
    room.seats[seat] = null;
    return { ok: true };
  }));

  socket.on('start', (_, cb) => act(cb, (_seat, g) => {
    if (g.phase !== 'waiting') return { ok: false, error: '对局已开始' };
    if (room.seats.some((s) => !s)) return { ok: false, error: '需要坐满 4 人' };
    if (g.roundNo === 0) room.newGame(); // 按房间设置的级数开打
    room.syncBots();
    room.game.startRound();
    room.loadedFrom = null;
    return { ok: true };
  }));

  socket.on('play', ({ cardIds, optionIndex } = {}, cb) => playAct(cb, (seat, g) =>
    g.play(seat, Array.isArray(cardIds) ? cardIds.map(String) : [], optionIndex)));

  socket.on('pass', (_, cb) => playAct(cb, (seat, g) => g.pass(seat)));

  socket.on('tribute', ({ cardId } = {}, cb) => playAct(cb, (seat, g) =>
    (g.phase === 'return' ? g.returnTribute(seat, String(cardId)) : g.payTribute(seat, String(cardId)))));

  socket.on('auto', ({ on } = {}, cb) => playAct(cb, (seat, g) => {
    if (!['tribute', 'return', 'playing'].includes(g.phase)) return { ok: false, error: '对局未进行' };
    g.setAuto(seat, on);
    return { ok: true };
  }));

  socket.on('nextRound', (_, cb) => playAct(cb, (_seat, g) => {
    if (g.phase === 'matchOver') {
      // 整场结束：重开一场，座位保留
      room.newGame();
      room.syncBots();
      room.game.startRound();
      return { ok: true };
    }
    return g.nextRound() ? { ok: true } : { ok: false, error: '当前不能开始下一局' };
  }));

  socket.on('avatar', ({ dataUrl } = {}, cb) => {
    if (!room) return;
    const url = putAvatar(dataUrl);
    if (!url) return reply(cb, { ok: false, error: '头像图片无效' });
    me.avatar = url;
    const seat = mySeat();
    if (seat >= 0) room.seats[seat].avatar = url;
    reply(cb, { ok: true, url });
    broadcast(room);
  });

  // 上帝视角：仅观战者生效，入座后自动失效
  socket.on('godView', ({ on } = {}) => {
    if (!room) return;
    me.god = !!on;
    broadcast(room);
  });

  // 房间设置：入座玩家可改；起始级数只能开局前改
  socket.on('settings', (patch = {}, cb) => act(cb, (_seat, g) => {
    const st = room.settings;
    const next = { ...st };
    const notes = [];
    if (patch.turnSec != null) {
      if (!TURN_CHOICES.includes(Number(patch.turnSec))) return { ok: false, error: '时限无效' };
      next.turnSec = Number(patch.turnSec);
      if (next.turnSec !== st.turnSec) notes.push(`每步时限 ${next.turnSec} 秒`);
    }
    if (patch.startLevel != null) {
      const lv = Number(patch.startLevel);
      if (!(lv >= 2 && lv <= 14)) return { ok: false, error: '级数无效' };
      if (lv !== st.startLevel && g.phase !== 'waiting') return { ok: false, error: '对局开始后不能改起始级数' };
      next.startLevel = lv;
      if (lv !== st.startLevel) notes.push(`从 ${'23456789TJQKA'[lv - 2].replace('T', '10')} 打起`);
    }
    if (patch.botSkill != null) {
      if (!SKILLS.includes(patch.botSkill)) return { ok: false, error: '难度无效' };
      next.botSkill = patch.botSkill;
      if (next.botSkill !== st.botSkill) notes.push(`机器人难度：${{ easy: '简单', normal: '普通', hard: '困难' }[next.botSkill]}`);
    }
    if (patch.password != null) {
      next.password = String(patch.password).trim().slice(0, 16);
      if (next.password !== st.password) notes.push(next.password ? '已设置房间密码' : '已取消房间密码');
    }
    room.settings = next;
    if (g.phase === 'waiting') room.game.teamLevels = [next.startLevel, next.startLevel];
    if (notes.length) io.to(room.id).emit('chat', room.addChat('系统', null, `${me.name} 修改了设置：${notes.join('，')}`, true));
    room.stepKey = null; // 新时限从下一步开始生效
    return { ok: true };
  }));

  // —— 存档 / 读档 / 暂停 ——
  socket.on('save', (_, cb) => act(cb, (_seat, g) => {
    if (g.phase === 'waiting') return { ok: false, error: '对局还没开始' };
    room.paused = true;
    const savedAt = Date.now();
    const names = room.seats.map((s) => s?.name || '');
    return {
      ok: true,
      code: encodeSave({ savedAt, names, game: g }),
      meta: { savedAt, names, teamLevels: g.teamLevels, levelTeam: g.levelTeam, roundNo: g.roundNo },
    };
  }));

  socket.on('pause', (_, cb) => act(cb, (_seat, g) => {
    if (!['tribute', 'return', 'playing', 'roundOver'].includes(g.phase)) return { ok: false, error: '当前不能暂停' };
    room.paused = true;
    return { ok: true };
  }));

  socket.on('resume', (_, cb) => act(cb, () => {
    if (!room.paused) return { ok: false, error: '对局没有暂停' };
    if (room.seats.some((s) => !s)) return { ok: false, error: '需要坐满 4 人（可用机器人补位）' };
    room.resume();
    room.loadedFrom = null;
    return { ok: true };
  }));

  // 读档：开局前或暂停中，房间里任何人都可以读
  socket.on('load', ({ code } = {}, cb) => {
    if (!room) return;
    if (!room.seatsOpen) return reply(cb, { ok: false, error: '对局进行中，请先暂停' });
    const data = decodeSave(code);
    if (!data) return reply(cb, { ok: false, error: '存档无效（可能已损坏，或服务器密钥变了）' });
    room.game = Game.fromJSON(data.game);
    room.game.auto = [false, false, false, false];
    room.paused = true;
    room.loadedFrom = { savedAt: data.savedAt, names: data.names };
    reply(cb, { ok: true });
    changed(room);
  });

  socket.on('chat', ({ text } = {}, cb) => {
    if (!room) return;
    text = String(text || '').trim().slice(0, 100);
    if (!text) return;
    const now = Date.now();
    if (now - lastChat < 800) return reply(cb, { ok: false, error: '发言太快了' });
    lastChat = now;
    const seat = mySeat();
    io.to(room.id).emit('chat', room.addChat(me.name, seat < 0 ? null : seat, text));
    dirty = true;
    reply(cb, { ok: true });
  });

  // 互动表情：丢给某个座位（观众也能丢），限速
  const EMOTES = ['flower', 'like', 'egg', 'bomb', 'beer'];
  let lastEmote = 0;
  socket.on('emote', ({ to, kind } = {}, cb) => {
    if (!room || !(to >= 0 && to < 4) || !room.seats[to] || !EMOTES.includes(kind)) return reply(cb, { ok: false, error: '参数错误' });
    const now = Date.now();
    if (now - lastEmote < 1500) return reply(cb, { ok: false, error: '慢一点' });
    lastEmote = now;
    const seat = mySeat();
    io.to(room.id).emit('emote', { from: seat < 0 ? null : seat, to, kind, name: me.name });
    reply(cb, { ok: true });
  });

  socket.on('disconnect', () => {
    if (!room) return;
    const r = room;
    const pid = me.playerId;
    r.members.delete(socket.id);
    // 对局中掉线：稍等一会儿（刷新页面会很快回来），仍不在线就托管
    setTimeout(() => {
      const seat = r.seatOf(pid);
      if (seat >= 0 && !r.isOnline(pid) && r.markOffline(seat)) changed(r);
    }, OFFLINE_AUTO_MS);
    // 开局前或暂停中，掉线超过 60 秒自动让出座位（刷新页面不受影响）；对局中保留座位，超时会自动托管
    setTimeout(() => {
      const seat = r.seatOf(pid);
      if (seat >= 0 && !r.isOnline(pid) && r.seatsOpen) {
        r.seats[seat] = null;
        changed(r);
      }
    }, SEAT_GRACE_MS);
    if (r.members.size === 0) r.idleTimer = setTimeout(() => deleteRoom(r), ROOM_IDLE_MS);
    broadcast(r);
  });
});

await load();
httpServer.listen(PORT, () => console.log(`掼蛋服务已启动: http://localhost:${PORT}`));
