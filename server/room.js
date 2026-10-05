// 房间：座位、观战者、聊天、出牌计时与托管
import { Game } from './game.js';

export const TURN_MS = Number(process.env.TURN_SECONDS || 30) * 1000;
const AUTO_DELAY_MS = Number(process.env.AUTO_DELAY_MS || 1000);
const CHAT_KEEP = 50;
const BOT_NAMES = ['机器人·阿发', '机器人·小顺', '机器人·老炸', '机器人·对对'];

export class Room {
  /** onChange(room) 在状态变化后被调用（负责广播） */
  constructor(id, onChange) {
    this.id = id;
    this.seats = [null, null, null, null]; // { playerId, name }
    this.members = new Map(); // socketId -> { playerId, name }
    this.game = new Game();
    this.chat = [];
    this.onChange = onChange;
    this.timer = null;
    this.deadline = null;
    this.stepKey = null;
    this.idleTimer = null;
  }

  toJSON() {
    return { id: this.id, seats: this.seats, game: this.game, chat: this.chat };
  }

  static fromJSON(data, onChange) {
    const room = new Room(data.id, onChange);
    room.seats = data.seats;
    room.game = Game.fromJSON(data.game);
    room.chat = data.chat || [];
    return room;
  }

  seatOf(playerId) {
    return this.seats.findIndex((s) => s && s.playerId === playerId);
  }

  isOnline(playerId) {
    return [...this.members.values()].some((m) => m.playerId === playerId);
  }

  addBot(seat) {
    const used = new Set(this.seats.filter((s) => s?.bot).map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || '机器人';
    this.seats[seat] = { playerId: `bot-${seat}-${Date.now()}`, name, bot: true };
  }

  /** 机器人座位始终托管 */
  syncBots() {
    this.seats.forEach((s, i) => { if (s?.bot) this.game.setAuto(i, true); });
  }

  addChat(name, seat, text) {
    const msg = { name, seat, text, t: Date.now() };
    this.chat.push(msg);
    if (this.chat.length > CHAT_KEEP) this.chat.shift();
    return msg;
  }

  /** 状态变化后重新安排计时器 */
  schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    const g = this.game;
    const pending = g.pendingSeats();
    if (!pending.length) {
      this.deadline = null;
      this.stepKey = null;
      return;
    }
    const key = g.stepKey();
    if (key !== this.stepKey) {
      this.stepKey = key;
      this.deadline = Date.now() + TURN_MS;
    }
    const anyAuto = pending.some((s) => g.auto[s]);
    const delay = anyAuto ? AUTO_DELAY_MS : Math.max(0, this.deadline - Date.now());
    this.timer = setTimeout(() => this.tick(), delay);
  }

  tick() {
    const g = this.game;
    const now = Date.now();
    for (const seat of g.pendingSeats()) {
      if (g.auto[seat]) {
        g.autoAct(seat);
      } else if (now >= this.deadline - 20) {
        // 超时：自动出牌并进入托管
        g.setAuto(seat, true);
        g.autoAct(seat);
      }
    }
    this.onChange(this);
  }

  dispose() {
    clearTimeout(this.timer);
    clearTimeout(this.idleTimer);
  }
}
