import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { chooseMove } from '../server/ai.js';
import { Room } from '../server/room.js';
import { findCombos } from '../shared/hint.js';
import { analyze, canBeat, bombPower, TYPES } from '../shared/rules.js';

let uid = 0;
function c(s) {
  uid++;
  if (s === 'X') return { id: `f${uid}`, suit: 'J', rank: 16 };
  if (s === 'BJ') return { id: `f${uid}`, suit: 'J', rank: 17 };
  const map = { J: 11, Q: 12, K: 13, A: 14 };
  const r = s.slice(1);
  return { id: `f${uid}`, suit: s[0], rank: map[r] || Number(r) };
}
const cs = (str) => str.split(' ').map(c);

/** 构造一局已结束、即将进贡的对局 */
function afterRound(finishOrder, hands) {
  const g = new Game();
  g.lastResult = { finishOrder };
  g.startRound();
  if (hands) {
    g.hands = hands.map(cs);
    g.setupTribute();
  }
  return g;
}

test('单贡：末游进贡最大牌给头游，头游还贡，进贡者先出', () => {
  const g = afterRound([0, 1, 2, 3], ['S3 S4', 'S5 S6', 'S7 S8', 'SA S9 X']);
  assert.equal(g.phase, 'tribute');
  assert.deepEqual(g.pendingSeats(), [3]);
  const [a, , x] = g.hands[3];
  assert.equal(g.payTribute(3, a.id).ok, false); // 必须贡最大的（小王）
  assert.ok(g.payTribute(3, x.id).ok);
  assert.equal(g.phase, 'return');
  assert.deepEqual(g.pendingSeats(), [0]);
  assert.ok(g.hands[0].some((h) => h.rank === 16));
  const big = g.hands[0].find((h) => h.rank === 16);
  assert.equal(g.returnTribute(0, big.id).ok, false); // 还贡须 ≤10
  assert.ok(g.returnTribute(0, g.hands[0].find((h) => h.rank === 3).id).ok);
  assert.equal(g.phase, 'playing');
  assert.equal(g.turn, 3);
  assert.equal(g.hands[3].length, 3);
});

test('逢人配不能用来进贡', () => {
  const g = afterRound([0, 1, 2, 3], ['S3', 'S5', 'S7', 'H2 SK']); // 打 2，H2 是逢人配
  const k = g.hands[3].find((h) => h.rank === 13);
  const wild = g.hands[3].find((h) => h.rank === 2);
  assert.equal(g.payTribute(3, wild.id).ok, false);
  assert.ok(g.payTribute(3, k.id).ok);
});

test('双贡：大牌给头游，贡大牌者先出', () => {
  // 0、2 双下；1 三游，3 末游
  const g = afterRound([0, 2, 1, 3], ['S3 S4', 'SK S5', 'D3 D4', 'SA S6']);
  assert.equal(g.tribute.kind, 'double');
  assert.deepEqual(g.pendingSeats().sort(), [1, 3]);
  g.payTribute(1, g.hands[1][0].id); // K
  g.payTribute(3, g.hands[3][0].id); // A
  assert.equal(g.phase, 'return');
  const e3 = g.tribute.entries.find((e) => e.from === 3);
  const e1 = g.tribute.entries.find((e) => e.from === 1);
  assert.equal(e3.to, 0);
  assert.equal(e1.to, 2);
  g.returnTribute(0, g.hands[0].find((h) => h.rank === 3).id);
  g.returnTribute(2, g.hands[2].find((h) => h.rank === 3).id);
  assert.equal(g.phase, 'playing');
  assert.equal(g.turn, 3);
});

test('抗贡：进贡方共持两张大王则免贡，头游先出', () => {
  const g = afterRound([0, 1, 2, 3], ['S3', 'S5', 'S7', 'BJ BJ S4']);
  assert.equal(g.tribute.kind, 'resist');
  assert.equal(g.phase, 'playing');
  assert.equal(g.turn, 0);
  const d = afterRound([0, 2, 1, 3], ['S3', 'BJ S5', 'S7', 'BJ S4']);
  assert.equal(d.tribute.kind, 'resist');
});

test('第一局不进贡', () => {
  const g = new Game();
  g.startRound();
  assert.equal(g.phase, 'playing');
  assert.equal(g.tribute, null);
});

function finishRound(g, order) {
  // 直接按指定名次结束本局
  g.phase = 'playing';
  g.finishOrder = [];
  for (const s of order) {
    g.finishOrder.push(s);
    if (g.checkRoundOver()) return;
  }
}

test('打 A 失败三次退回 2', () => {
  const g = new Game();
  g.teamLevels = [14, 5];
  g.levelTeam = 0;
  g.hands = [[], [], [], []];
  // 第 1 次：对手赢
  finishRound(g, [1, 0, 3, 2]);
  assert.equal(g.aFails[0], 1);
  assert.equal(g.levelTeam, 1);
  // 不是庄家时不计失败
  finishRound(g, [1, 3, 0, 2]);
  assert.equal(g.aFails[0], 1);
  // 重新坐庄打 A：头游+末游，升级但未过 A
  g.levelTeam = 0;
  finishRound(g, [0, 1, 3, 2]);
  assert.equal(g.aFails[0], 2);
  assert.equal(g.phase, 'roundOver');
  finishRound(g, [3, 0, 1, 2]);
  assert.equal(g.teamLevels[0], 2);
  assert.equal(g.aFails[0], 0);
  assert.ok(g.lastResult.aFail.dropped);
});

test('提示：只给能压过的牌，且从小到大', () => {
  const hand = cs('S3 D3 S7 D7 C9 H9 SK DK CK HK');
  const last = analyze(cs('S5 D5'), 2)[0];
  const list = findCombos(hand, 2, last);
  assert.ok(list.length > 0);
  for (const h of list) assert.ok(canBeat(h.combo, last));
  assert.equal(list[0].combo.type, TYPES.PAIR);
  assert.equal(list[0].combo.key, 7);
  assert.ok(list.some((h) => h.combo.type === TYPES.BOMB));
  assert.equal(bombPower(list.at(-1).combo), 4);
});

test('提示：识别顺子、同花顺、逢人配补牌', () => {
  const hand = cs('S3 S4 S5 S6 D8 H2');
  const list = findCombos(hand, 2, null);
  assert.ok(list.some((h) => h.combo.type === TYPES.STRAIGHT && h.wilds === 1));
  assert.ok(list.some((h) => h.combo.type === TYPES.STRAIGHT_FLUSH));
  // 每个提示都必须能被规则引擎认可
  for (const h of list) assert.ok(analyze(h.cards, 2).length);
});

test('托管 AI 能独立打完多场完整比赛（模糊测试）', () => {
  let seed = 42;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let m = 0; m < 5; m++) {
    const g = new Game({ random });
    g.startRound();
    let steps = 0;
    while (g.phase !== 'matchOver' && g.roundNo < 40) {
      if (g.phase === 'roundOver') { g.nextRound(); continue; }
      const pending = g.pendingSeats();
      assert.ok(pending.length, `phase ${g.phase} 没有待操作玩家`);
      const before = g.actions;
      for (const s of pending) g.autoAct(s);
      assert.ok(g.actions > before, `托管没有产生动作 phase=${g.phase}`);
      // 进贡/还贡之外，手牌 + 已出的牌不会凭空增减
      assert.ok(g.hands.reduce((n, h) => n + h.length, 0) <= 108);
      assert.ok(++steps < 50000);
    }
    assert.ok(g.roundNo >= 1);
  }
});

test('持久化往返', () => {
  const g = new Game();
  g.startRound(0);
  const back = Game.fromJSON(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(back.view(1), g.view(1));
  back.autoAct(0);
  assert.equal(back.actions, g.actions + 1);
});

// —— 机器人 ——

const ctx = (hand, lastPlay, extra = {}) => ({
  hand: cs(hand), level: 2, seat: 0, lastPlay, handCounts: [10, 20, 20, 20], finishOrder: [], ...extra,
});

test('AI 不压队友', () => {
  const last = { seat: 2, combo: analyze(cs('S5'), 2)[0] };
  assert.equal(chooseMove(ctx('S9 DK', last)), null);
});

test('AI 局面不紧张时不拆炸弹接小牌', () => {
  const last = { seat: 1, combo: analyze(cs('S5'), 2)[0] };
  assert.equal(chooseMove(ctx('S9 D9 C9 H9 S3', last)), null);
  // 对手只剩 3 张时就要管
  const urgent = chooseMove(ctx('S9 D9 C9 H9 S3', last, { handCounts: [5, 3, 20, 20] }));
  assert.ok(urgent);
});

test('AI 首出优先甩连牌、对手剩 1 张时不出小单张', () => {
  const lead = chooseMove(ctx('S3 D4 C5 S6 H7 SK', null));
  assert.equal(lead.combo.type, TYPES.STRAIGHT);
  const guard = chooseMove(ctx('S3 S8 D8', null, { handCounts: [3, 1, 20, 20] }));
  assert.notEqual(guard.combo.type, TYPES.SINGLE);
});

test('机器人座位始终托管，不占用观战名单', () => {
  const room = new Room('T', () => {});
  room.addBot(1);
  room.addBot(3);
  assert.ok(room.seats[1].bot && room.seats[3].bot);
  assert.notEqual(room.seats[1].name, room.seats[3].name);
  room.game.startRound(0);
  room.syncBots();
  assert.deepEqual(room.game.auto, [false, true, false, true]);
  room.dispose();
});

test('上帝视角只对观战者生效', () => {
  const g = new Game();
  g.startRound(0);
  assert.equal(g.view(null).allHands, null);
  assert.equal(g.view(null, { god: true }).allHands.length, 4);
  assert.equal(g.view(null, { god: true }).allHands[2].length, 27);
  assert.equal(g.view(1, { god: true }).allHands, null); // 玩家拿不到别人的手牌
});

test('记牌器：统计本局已出的牌', () => {
  const g = new Game();
  g.startRound(0);
  g.hands[0] = cs('S5 D5 SK');
  g.play(0, g.hands[0].slice(0, 2).map((c) => c.id));
  assert.deepEqual(g.view(1).playedCounts, { 5: 2 });
  g.startRound(0);
  assert.deepEqual(g.view(null).playedCounts, {});
});
