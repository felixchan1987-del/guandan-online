// 一局掼蛋的状态机（不含网络），座位 0/2 为一队，1/3 为一队
import {
  createDeck, shuffle, sortHand, playableOptions, upgradeAmount, describeCombo,
} from '../shared/rules.js';

export const teamOf = (seat) => seat % 2;
export const partnerOf = (seat) => (seat + 2) % 4;

export class Game {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.teamLevels = [2, 2];
    this.levelTeam = 0; // 当前打谁的级
    this.roundNo = 0;
    this.phase = 'waiting'; // waiting | playing | roundOver | matchOver
    this.lastResult = null;
    this.matchWinner = null;
  }

  get level() {
    return this.teamLevels[this.levelTeam];
  }

  startRound(leader) {
    const deck = shuffle(createDeck(), this.random);
    this.hands = [0, 1, 2, 3].map((i) => sortHand(deck.slice(i * 27, i * 27 + 27), this.level));
    this.roundNo += 1;
    this.phase = 'playing';
    this.finishOrder = [];
    this.turn = leader ?? Math.floor(this.random() * 4);
    this.lastPlay = null; // { seat, cards, combo }
    this.passCount = 0;
    this.trick = [null, null, null, null]; // 本轮每个座位的最近动作，供界面显示
    this.log = [];
  }

  isActive(seat) {
    return !this.finishOrder.includes(seat);
  }

  nextActive(seat) {
    for (let i = 1; i <= 4; i++) {
      const s = (seat + i) % 4;
      if (this.isActive(s)) return s;
    }
    return seat;
  }

  /** 出牌。成功返回 { ok: true }，失败返回 { ok: false, error } */
  play(seat, cardIds, optionIndex = 0) {
    if (this.phase !== 'playing') return { ok: false, error: '当前不在出牌阶段' };
    if (seat !== this.turn) return { ok: false, error: '还没轮到你' };
    const hand = this.hands[seat];
    const ids = new Set(cardIds);
    if (ids.size !== cardIds.length || ids.size === 0) return { ok: false, error: '选牌无效' };
    const cards = hand.filter((c) => ids.has(c.id));
    if (cards.length !== ids.size) return { ok: false, error: '手里没有这些牌' };

    const lead = !this.lastPlay;
    const options = playableOptions(cards, this.level, lead ? null : this.lastPlay.combo);
    if (!options.length) return { ok: false, error: lead ? '不是合法牌型' : '管不上' };
    const combo = options[Math.min(Math.max(optionIndex | 0, 0), options.length - 1)];

    this.hands[seat] = hand.filter((c) => !ids.has(c.id));
    if (lead) this.trick = [null, null, null, null];
    this.lastPlay = { seat, cards, combo };
    this.trick[seat] = { type: 'play', cards, desc: describeCombo(combo) };
    this.passCount = 0;
    this.log.push({ seat, action: 'play', desc: describeCombo(combo) });

    if (this.hands[seat].length === 0) {
      this.finishOrder.push(seat);
      if (this.checkRoundOver()) return { ok: true };
    }
    this.turn = this.nextActive(seat);
    return { ok: true };
  }

  pass(seat) {
    if (this.phase !== 'playing') return { ok: false, error: '当前不在出牌阶段' };
    if (seat !== this.turn) return { ok: false, error: '还没轮到你' };
    if (!this.lastPlay) return { ok: false, error: '首出不能不出' };
    this.passCount += 1;
    this.trick[seat] = { type: 'pass' };
    this.log.push({ seat, action: 'pass' });

    const leader = this.lastPlay.seat;
    const activeCount = 4 - this.finishOrder.length;
    const needed = this.isActive(leader) ? activeCount - 1 : activeCount;
    if (this.passCount >= needed) {
      // 一轮结束：出牌者继续首出；出牌者已走完则由队友接风
      const next = this.isActive(leader) ? leader : partnerOf(leader);
      this.turn = this.isActive(next) ? next : this.nextActive(next);
      this.lastPlay = null;
      this.passCount = 0;
    } else {
      this.turn = this.nextActive(seat);
    }
    return { ok: true };
  }

  checkRoundOver() {
    const fo = this.finishOrder;
    const first = fo[0];
    const teamDone = fo.length >= 2 && fo.includes(partnerOf(fo[fo.length - 1]));
    if (!teamDone) return false;

    // 补全剩余名次（按座位顺序，对结算无影响）
    for (let s = 0; s < 4; s++) if (!fo.includes(s)) fo.push(s);

    const winTeam = teamOf(first);
    const up = upgradeAmount(fo);
    const before = this.teamLevels[winTeam];
    let matchWon = false;
    // 打 A：本队是庄家且队友不是末游即过 A 胜出
    if (before === 14 && this.levelTeam === winTeam && up >= 2) matchWon = true;
    const after = Math.min(14, before + up);
    this.teamLevels[winTeam] = after;
    this.levelTeam = winTeam;
    this.lastResult = { finishOrder: fo.slice(), winTeam, up, from: before, to: after, matchWon };
    this.phase = matchWon ? 'matchOver' : 'roundOver';
    if (matchWon) this.matchWinner = winTeam;
    this.turn = null;
    return true;
  }

  /** 下一局由上局头游先出 */
  nextRound() {
    if (this.phase !== 'roundOver') return false;
    this.startRound(this.lastResult.finishOrder[0]);
    return true;
  }

  /** 给某个视角的状态；seat 为 null 表示观战者 */
  view(seat) {
    const base = {
      phase: this.phase,
      teamLevels: this.teamLevels,
      levelTeam: this.levelTeam,
      level: this.level,
      roundNo: this.roundNo,
      lastResult: this.lastResult,
      matchWinner: this.matchWinner,
    };
    if (!this.hands) return base;
    return {
      ...base,
      turn: this.turn,
      handCounts: this.hands.map((h) => h.length),
      finishOrder: this.finishOrder,
      lastPlay: this.lastPlay && { seat: this.lastPlay.seat, combo: this.lastPlay.combo },
      trick: this.trick,
      myHand: seat == null ? null : this.hands[seat],
      // 局结束后公开所有剩余手牌
      revealed: this.phase === 'playing' ? null : this.hands,
    };
  }
}
