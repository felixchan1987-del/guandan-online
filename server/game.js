// 一场掼蛋的状态机（不含网络），座位 0/2 为一队，1/3 为一队
import {
  createDeck, shuffle, sortHand, playableOptions, upgradeAmount, describeCombo,
  rankValue, bombPower, tributeCandidates, returnCandidates, BIG_JOKER,
} from '../shared/rules.js';
import { findCombos } from '../shared/hint.js';

export const teamOf = (seat) => seat % 2;
export const partnerOf = (seat) => (seat + 2) % 4;

const A = 14;
const A_FAIL_LIMIT = 3;

export class Game {
  constructor({ random = Math.random } = {}) {
    Object.defineProperty(this, 'random', { value: random, writable: true, enumerable: false });
    this.teamLevels = [2, 2];
    this.levelTeam = 0; // 当前打谁的级
    this.aFails = [0, 0]; // 打 A 失败次数
    this.roundNo = 0;
    this.phase = 'waiting'; // waiting | tribute | return | playing | roundOver | matchOver
    this.lastResult = null;
    this.matchWinner = null;
    this.tribute = null;
    this.auto = [false, false, false, false];
    this.actions = 0;
  }

  /** 从持久化数据恢复 */
  static fromJSON(data) {
    return Object.assign(new Game(), data);
  }

  get level() {
    return this.teamLevels[this.levelTeam];
  }

  /** 发牌开局。第一局随机/指定首出；之后先进贡 */
  startRound(leader) {
    const deck = shuffle(createDeck(), this.random);
    this.hands = [0, 1, 2, 3].map((i) => sortHand(deck.slice(i * 27, i * 27 + 27), this.level));
    this.roundNo += 1;
    this.finishOrder = [];
    this.lastPlay = null; // { seat, cards, combo }
    this.passCount = 0;
    this.trick = [null, null, null, null]; // 本轮每个座位的最近动作，供界面显示
    this.tribute = null;
    this.actions += 1;
    if (this.lastResult && leader == null) {
      this.setupTribute();
    } else {
      this.phase = 'playing';
      this.turn = leader ?? Math.floor(this.random() * 4);
    }
  }

  // —— 进贡 / 还贡 / 抗贡 ——
  setupTribute() {
    const fo = this.lastResult.finishOrder;
    const double = teamOf(fo[0]) === teamOf(fo[1]);
    const payers = double ? [fo[2], fo[3]] : [fo[3]];
    const bigJokers = payers.reduce(
      (n, s) => n + this.hands[s].filter((c) => c.rank === BIG_JOKER).length, 0);
    if (bigJokers >= 2) {
      // 抗贡：头游先出
      this.tribute = { kind: 'resist', payers, entries: [] };
      this.phase = 'playing';
      this.turn = fo[0];
      return;
    }
    this.tribute = {
      kind: double ? 'double' : 'single',
      entries: payers.map((from) => ({ from, to: double ? null : fo[0], card: null, back: null })),
    };
    this.phase = 'tribute';
    this.turn = null;
  }

  takeCard(seat, cardId) {
    const hand = this.hands[seat];
    const i = hand.findIndex((c) => c.id === cardId);
    return i < 0 ? null : hand.splice(i, 1)[0];
  }

  payTribute(seat, cardId) {
    if (this.phase !== 'tribute') return { ok: false, error: '当前不是进贡阶段' };
    const entry = this.tribute.entries.find((e) => e.from === seat && !e.card);
    if (!entry) return { ok: false, error: '你不需要进贡' };
    const allowed = tributeCandidates(this.hands[seat], this.level).map((c) => c.id);
    if (!allowed.includes(cardId)) return { ok: false, error: '必须进贡最大的牌（逢人配除外）' };
    entry.card = this.takeCard(seat, cardId);
    this.actions += 1;
    if (this.tribute.entries.every((e) => e.card)) this.resolveTribute();
    return { ok: true };
  }

  resolveTribute() {
    const fo = this.lastResult.finishOrder;
    const entries = this.tribute.entries;
    if (this.tribute.kind === 'double') {
      const [a, b] = entries;
      const va = rankValue(a.card.rank, this.level);
      const vb = rankValue(b.card.rank, this.level);
      let big;
      if (va === vb) big = entries.find((e) => e.from === (fo[0] + 1) % 4) || a; // 相同则头游下家贡给头游
      else big = va > vb ? a : b;
      const small = big === a ? b : a;
      big.to = fo[0];
      small.to = fo[1];
      this.tribute.leader = big.from;
    } else {
      this.tribute.leader = entries[0].from;
    }
    for (const e of entries) {
      this.hands[e.to].push(e.card);
      this.hands[e.to] = sortHand(this.hands[e.to], this.level);
    }
    this.phase = 'return';
  }

  returnTribute(seat, cardId) {
    if (this.phase !== 'return') return { ok: false, error: '当前不是还贡阶段' };
    const entry = this.tribute.entries.find((e) => e.to === seat && !e.back);
    if (!entry) return { ok: false, error: '你不需要还贡' };
    const allowed = returnCandidates(this.hands[seat]).map((c) => c.id);
    if (!allowed.includes(cardId)) return { ok: false, error: '还贡须为 10 及以下的牌' };
    entry.back = this.takeCard(seat, cardId);
    this.actions += 1;
    if (this.tribute.entries.every((e) => e.back)) {
      for (const e of this.tribute.entries) {
        this.hands[e.from].push(e.back);
        this.hands[e.from] = sortHand(this.hands[e.from], this.level);
      }
      this.phase = 'playing';
      this.turn = this.tribute.leader; // 进贡者（双贡时贡大牌者）先出
    }
    return { ok: true };
  }

  // —— 出牌 ——
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
    this.actions += 1;

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
    this.actions += 1;

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
    const teamDone = fo.length >= 2 && fo.includes(partnerOf(fo[fo.length - 1]));
    if (!teamDone) return false;

    // 补全剩余名次（按座位顺序，对结算无影响）
    for (let s = 0; s < 4; s++) if (!fo.includes(s)) fo.push(s);

    const winTeam = teamOf(fo[0]);
    const declTeam = this.levelTeam;
    const up = upgradeAmount(fo);
    const from = this.teamLevels[winTeam];
    // 打 A：本队是庄家且队友不是末游即过 A 胜出
    const matchWon = from === A && declTeam === winTeam && up >= 2;
    const to = Math.min(A, from + up);
    this.teamLevels[winTeam] = to;

    // 打 A 未过：庄家队失败计数，满 3 次退回打 2
    let aFail = null;
    if (this.teamLevels[declTeam] === A && !matchWon && (declTeam !== winTeam || from === A)) {
      this.aFails[declTeam] += 1;
      aFail = { team: declTeam, count: this.aFails[declTeam], dropped: false };
      if (this.aFails[declTeam] >= A_FAIL_LIMIT) {
        this.teamLevels[declTeam] = 2;
        this.aFails[declTeam] = 0;
        aFail.dropped = true;
      }
    }

    this.levelTeam = winTeam;
    this.lastResult = { finishOrder: fo.slice(), winTeam, up, from, to, matchWon, aFail };
    this.phase = matchWon ? 'matchOver' : 'roundOver';
    if (matchWon) this.matchWinner = winTeam;
    this.turn = null;
    this.actions += 1;
    return true;
  }

  nextRound() {
    if (this.phase !== 'roundOver') return false;
    this.startRound();
    return true;
  }

  // —— 计时与托管 ——
  /** 当前需要操作的座位 */
  pendingSeats() {
    if (this.phase === 'playing') return [this.turn];
    if (this.phase === 'tribute') return this.tribute.entries.filter((e) => !e.card).map((e) => e.from);
    if (this.phase === 'return') return this.tribute.entries.filter((e) => !e.back).map((e) => e.to);
    return [];
  }

  /** 标识“同一步”，用于计时：同一步内不重置倒计时 */
  stepKey() {
    if (this.phase === 'playing') return `${this.roundNo}:p:${this.actions}`;
    return `${this.roundNo}:${this.phase}`;
  }

  setAuto(seat, on) {
    this.auto[seat] = !!on;
  }

  /** 替某个座位自动操作（超时或托管） */
  autoAct(seat) {
    if (!this.pendingSeats().includes(seat)) return;
    const hand = this.hands[seat];
    if (this.phase === 'tribute') {
      this.payTribute(seat, tributeCandidates(hand, this.level).at(-1).id);
    } else if (this.phase === 'return') {
      const opts = returnCandidates(hand);
      const low = opts.reduce((a, b) => (rankValue(b.rank, this.level) < rankValue(a.rank, this.level) ? b : a));
      this.returnTribute(seat, low.id);
    } else if (this.phase === 'playing') {
      const choice = this.aiChoose(seat);
      if (choice) {
        const opts = playableOptions(choice.cards, this.level, this.lastPlay?.combo);
        const idx = opts.findIndex((o) => o.type === choice.combo.type && o.key === choice.combo.key);
        this.play(seat, choice.cards.map((c) => c.id), Math.max(idx, 0));
      } else {
        this.pass(seat);
      }
    }
  }

  /** 简单托管策略：能一手出完就出完；首出出最小的牌型；跟牌不压队友，必要时才用炸弹 */
  aiChoose(seat) {
    const hand = this.hands[seat];
    const last = this.lastPlay;
    const cands = findCombos(hand, this.level, last?.combo);
    const finish = cands.find((c) => c.cards.length === hand.length);
    if (finish) return finish;
    const nonBomb = cands.filter((c) => bombPower(c.combo) === 0);
    if (!last) {
      const pool = nonBomb.length ? nonBomb : cands;
      // 优先出小牌，同等大小时多带几张
      return pool.slice().sort((a, b) =>
        a.combo.key - b.combo.key || b.cards.length - a.cards.length || a.wilds - b.wilds)[0];
    }
    if (teamOf(last.seat) === teamOf(seat)) return null;
    if (nonBomb.length) return nonBomb[0];
    if (cands.length && this.hands[last.seat].length <= 8) return cands[0];
    return null;
  }

  /** 给某个视角的状态；seat 为 null 表示观战者 */
  view(seat) {
    const base = {
      phase: this.phase,
      teamLevels: this.teamLevels,
      levelTeam: this.levelTeam,
      level: this.level,
      aFails: this.aFails,
      roundNo: this.roundNo,
      lastResult: this.lastResult,
      matchWinner: this.matchWinner,
      auto: this.auto,
    };
    if (!this.hands) return base;
    let tribute = null;
    if (this.tribute) {
      tribute = {
        kind: this.tribute.kind,
        payers: this.tribute.payers,
        entries: this.tribute.entries.map((e) => ({
          from: e.from,
          to: e.to,
          paid: !!e.card,
          returned: !!e.back,
          // 进贡牌在全部进贡完成后公开；还贡牌在全部还贡完成后公开
          card: this.phase === 'tribute' ? null : e.card,
          back: this.phase === 'return' || this.phase === 'tribute' ? null : e.back,
        })),
      };
    }
    return {
      ...base,
      turn: this.turn,
      pending: this.pendingSeats(),
      handCounts: this.hands.map((h) => h.length),
      finishOrder: this.finishOrder,
      lastPlay: this.lastPlay && { seat: this.lastPlay.seat, combo: this.lastPlay.combo },
      trick: this.trick,
      tribute,
      myHand: seat == null ? null : this.hands[seat],
      // 局结束后公开所有剩余手牌
      revealed: this.phase === 'roundOver' || this.phase === 'matchOver' ? this.hands : null,
    };
  }
}
