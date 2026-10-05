import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Game } from './game.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.env.PORT || 3000;
const ROOM_IDLE_MS = 30 * 60 * 1000;

const app = express();
app.use('/shared', express.static(path.join(root, 'shared')));
app.use(express.static(path.join(root, 'public')));
// /r/房间号 直接进入房间页
app.get('/r/:roomId', (_req, res) => res.sendFile(path.join(root, 'public', 'index.html')));

const httpServer = createServer(app);
const io = new Server(httpServer);

/** roomId -> { id, seats: [{playerId,name}|null]x4, members: Map<socketId,{playerId,name}>, game, idleTimer } */
const rooms = new Map();

function getRoom(id) {
  let room = rooms.get(id);
  if (!room) {
    room = { id, seats: [null, null, null, null], members: new Map(), game: new Game(), idleTimer: null };
    rooms.set(id, room);
  }
  clearTimeout(room.idleTimer);
  return room;
}

function seatOf(room, playerId) {
  return room.seats.findIndex((s) => s && s.playerId === playerId);
}

function broadcast(room) {
  const connected = new Set([...room.members.values()].map((m) => m.playerId));
  const seats = room.seats.map((s) => s && { name: s.name, online: connected.has(s.playerId) });
  const spectators = [...room.members.values()]
    .filter((m) => seatOf(room, m.playerId) < 0)
    .map((m) => m.name);
  for (const [socketId, m] of room.members) {
    const seat = seatOf(room, m.playerId);
    io.to(socketId).emit('state', {
      roomId: room.id,
      seats,
      spectators,
      mySeat: seat < 0 ? null : seat,
      game: room.game.view(seat < 0 ? null : seat),
    });
  }
}

const cleanName = (n) => String(n || '').trim().slice(0, 12) || '玩家';

io.on('connection', (socket) => {
  let room = null;
  let me = null;

  const reply = (cb, result) => typeof cb === 'function' && cb(result);
  const mySeat = () => (room ? seatOf(room, me.playerId) : -1);

  socket.on('join', ({ roomId, playerId, name } = {}, cb) => {
    roomId = String(roomId || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!roomId || !playerId) return reply(cb, { ok: false, error: '参数错误' });
    room = getRoom(roomId);
    me = { playerId: String(playerId).slice(0, 64), name: cleanName(name) };
    room.members.set(socket.id, me);
    socket.join(roomId);
    const seat = mySeat();
    if (seat >= 0) room.seats[seat].name = me.name;
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('sit', ({ seat } = {}, cb) => {
    if (!room) return;
    if (room.game.phase !== 'waiting') return reply(cb, { ok: false, error: '对局进行中，不能换座' });
    if (!(seat >= 0 && seat < 4) || room.seats[seat]) return reply(cb, { ok: false, error: '该座位已有人' });
    const cur = mySeat();
    if (cur >= 0) room.seats[cur] = null;
    room.seats[seat] = { playerId: me.playerId, name: me.name };
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('stand', (_, cb) => {
    if (!room) return;
    if (room.game.phase !== 'waiting') return reply(cb, { ok: false, error: '对局进行中，不能离座' });
    const cur = mySeat();
    if (cur >= 0) room.seats[cur] = null;
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('start', (_, cb) => {
    if (!room || mySeat() < 0) return;
    if (room.game.phase !== 'waiting') return reply(cb, { ok: false, error: '对局已开始' });
    if (room.seats.some((s) => !s)) return reply(cb, { ok: false, error: '需要坐满 4 人' });
    room.game.startRound();
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('play', ({ cardIds, optionIndex } = {}, cb) => {
    const seat = mySeat();
    if (seat < 0) return reply(cb, { ok: false, error: '观战者不能出牌' });
    const r = room.game.play(seat, Array.isArray(cardIds) ? cardIds.map(String) : [], optionIndex);
    reply(cb, r);
    if (r.ok) broadcast(room);
  });

  socket.on('pass', (_, cb) => {
    const seat = mySeat();
    if (seat < 0) return reply(cb, { ok: false, error: '观战者不能操作' });
    const r = room.game.pass(seat);
    reply(cb, r);
    if (r.ok) broadcast(room);
  });

  socket.on('nextRound', (_, cb) => {
    if (!room || mySeat() < 0) return;
    const g = room.game;
    if (g.phase === 'matchOver') {
      // 整场结束：重开一场，座位保留
      room.game = new Game();
      room.game.startRound();
    } else if (!g.nextRound()) {
      return reply(cb, { ok: false, error: '当前不能开始下一局' });
    }
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('disconnect', () => {
    if (!room) return;
    room.members.delete(socket.id);
    // 对局未开始时，掉线超过 60 秒自动离座（刷新页面不受影响）；对局中一直保留座位等待重连
    const r = room;
    const pid = me.playerId;
    setTimeout(() => {
      const seat = seatOf(r, pid);
      const back = [...r.members.values()].some((m) => m.playerId === pid);
      if (seat >= 0 && !back && r.game.phase === 'waiting') {
        r.seats[seat] = null;
        broadcast(r);
      }
    }, 60 * 1000);
    if (room.members.size === 0) {
      r.idleTimer = setTimeout(() => rooms.delete(r.id), ROOM_IDLE_MS);
    }
    broadcast(room);
  });
});

httpServer.listen(PORT, () => console.log(`掼蛋服务已启动: http://localhost:${PORT}`));
