import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { Game } from './game.js';
import { Room, TURN_MS } from './room.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE; // 设置后房间会持久化到该 JSON 文件
const ROOM_IDLE_MS = 30 * 60 * 1000;
const SEAT_GRACE_MS = 60 * 1000;

const app = express();
app.use('/shared', express.static(path.join(root, 'shared')));
app.use(express.static(path.join(root, 'public')));
// /r/房间号 直接进入房间页
app.get('/r/:roomId', (_req, res) => res.sendFile(path.join(root, 'public', 'index.html')));

const httpServer = createServer(app);
const io = new Server(httpServer);

/** roomId -> Room */
const rooms = new Map();
let dirty = false;

function changed(room) {
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
  const seats = room.seats.map((s) => s && { name: s.name, online: room.isOnline(s.playerId) });
  const spectators = [...room.members.values()]
    .filter((m) => room.seatOf(m.playerId) < 0)
    .map((m) => m.name);
  for (const [socketId, m] of room.members) {
    const seat = room.seatOf(m.playerId);
    io.to(socketId).emit('state', {
      roomId: room.id,
      seats,
      spectators,
      mySeat: seat < 0 ? null : seat,
      deadline: room.deadline,
      turnMs: TURN_MS,
      serverNow: Date.now(),
      game: room.game.view(seat < 0 ? null : seat),
    });
  }
}

// —— 持久化（可选） ——
function save() {
  if (!DATA_FILE || !dirty) return;
  dirty = false;
  try {
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...rooms.values()]));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.error('保存失败', e.message);
  }
}

function load() {
  if (!DATA_FILE || !fs.existsSync(DATA_FILE)) return;
  try {
    for (const data of JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))) {
      const room = Room.fromJSON(data, changed);
      rooms.set(room.id, room);
      room.schedule();
      room.idleTimer = setTimeout(() => deleteRoom(room), ROOM_IDLE_MS);
    }
    console.log(`已恢复 ${rooms.size} 个房间`);
  } catch (e) {
    console.error('读取存档失败', e.message);
  }
}

function deleteRoom(room) {
  if (room.members.size) return;
  room.dispose();
  rooms.delete(room.id);
  dirty = true;
}

load();
if (DATA_FILE) {
  setInterval(save, 10 * 1000).unref();
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => { dirty = true; save(); process.exit(0); });
  }
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

  socket.on('join', ({ roomId, playerId, name } = {}, cb) => {
    roomId = String(roomId || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!roomId || !playerId) return reply(cb, { ok: false, error: '参数错误' });
    if (room && room.id !== roomId) room.members.delete(socket.id);
    room = getRoom(roomId);
    me = { playerId: String(playerId).slice(0, 64), name: cleanName(name) };
    room.members.set(socket.id, me);
    socket.join(roomId);
    const seat = mySeat();
    if (seat >= 0) room.seats[seat].name = me.name;
    reply(cb, { ok: true });
    socket.emit('chatHistory', room.chat);
    changed(room);
  });

  socket.on('sit', ({ seat } = {}, cb) => {
    if (!room) return;
    if (room.game.phase !== 'waiting') return reply(cb, { ok: false, error: '对局进行中，不能换座' });
    if (!(seat >= 0 && seat < 4) || room.seats[seat]) return reply(cb, { ok: false, error: '该座位已有人' });
    const cur = mySeat();
    if (cur >= 0) room.seats[cur] = null;
    room.seats[seat] = { playerId: me.playerId, name: me.name };
    reply(cb, { ok: true });
    changed(room);
  });

  socket.on('stand', (_, cb) => {
    if (!room) return;
    if (room.game.phase !== 'waiting') return reply(cb, { ok: false, error: '对局进行中，不能离座' });
    const cur = mySeat();
    if (cur >= 0) room.seats[cur] = null;
    reply(cb, { ok: true });
    changed(room);
  });

  socket.on('start', (_, cb) => act(cb, (_seat, g) => {
    if (g.phase !== 'waiting') return { ok: false, error: '对局已开始' };
    if (room.seats.some((s) => !s)) return { ok: false, error: '需要坐满 4 人' };
    g.startRound();
    return { ok: true };
  }));

  socket.on('play', ({ cardIds, optionIndex } = {}, cb) => act(cb, (seat, g) =>
    g.play(seat, Array.isArray(cardIds) ? cardIds.map(String) : [], optionIndex)));

  socket.on('pass', (_, cb) => act(cb, (seat, g) => g.pass(seat)));

  socket.on('tribute', ({ cardId } = {}, cb) => act(cb, (seat, g) =>
    (g.phase === 'return' ? g.returnTribute(seat, String(cardId)) : g.payTribute(seat, String(cardId)))));

  socket.on('auto', ({ on } = {}, cb) => act(cb, (seat, g) => {
    if (!['tribute', 'return', 'playing'].includes(g.phase)) return { ok: false, error: '对局未进行' };
    g.setAuto(seat, on);
    return { ok: true };
  }));

  socket.on('nextRound', (_, cb) => act(cb, (_seat, g) => {
    if (g.phase === 'matchOver') {
      // 整场结束：重开一场，座位保留
      room.game = new Game();
      room.game.startRound();
      return { ok: true };
    }
    return g.nextRound() ? { ok: true } : { ok: false, error: '当前不能开始下一局' };
  }));

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

  socket.on('disconnect', () => {
    if (!room) return;
    const r = room;
    const pid = me.playerId;
    r.members.delete(socket.id);
    // 对局未开始时，掉线超过 60 秒自动离座（刷新页面不受影响）；对局中保留座位，超时会自动托管
    setTimeout(() => {
      const seat = r.seatOf(pid);
      if (seat >= 0 && !r.isOnline(pid) && r.game.phase === 'waiting') {
        r.seats[seat] = null;
        changed(r);
      }
    }, SEAT_GRACE_MS);
    if (r.members.size === 0) r.idleTimer = setTimeout(() => deleteRoom(r), ROOM_IDLE_MS);
    broadcast(r);
  });
});

httpServer.listen(PORT, () => console.log(`掼蛋服务已启动: http://localhost:${PORT}`));
