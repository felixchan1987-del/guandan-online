import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, canBeat, playableOptions, upgradeAmount, createDeck, TYPES } from '../shared/rules.js';
import { Game } from '../server/game.js';

// 简写：'S5' 'H10' 'DA' 'SJ'(J) 'X'(小王) 'D'(大王)
let uid = 0;
function c(s) {
  uid++;
  if (s === 'X') return { id: `t${uid}`, suit: 'J', rank: 16 };
  if (s === 'BJ') return { id: `t${uid}`, suit: 'J', rank: 17 };
  const map = { J: 11, Q: 12, K: 13, A: 14 };
  const r = s.slice(1);
  return { id: `t${uid}`, suit: s[0], rank: map[r] || Number(r) };
}
const cs = (str) => str.split(' ').map(c);
const types = (str, level = 2) => analyze(cs(str), level).map((o) => o.type);
const best = (str, level = 2) => analyze(cs(str), level)[0];

test('牌堆 108 张', () => {
  assert.equal(createDeck().length, 108);
  assert.equal(new Set(createDeck().map((x) => x.id)).size, 108);
});

test('基本牌型', () => {
  assert.deepEqual(types('S5'), [TYPES.SINGLE]);
  assert.deepEqual(types('S5 D5'), [TYPES.PAIR]);
  assert.deepEqual(types('S5 D5 C5'), [TYPES.TRIPLE]);
  assert.deepEqual(types('S5 D5 C5 S9 H9'), [TYPES.TRIPLE_PAIR]);
  assert.deepEqual(types('S3 D4 C5 S6 H7'), [TYPES.STRAIGHT]);
  assert.deepEqual(types('S3 D3 C4 S4 H5 D5'), [TYPES.PAIRS]);
  assert.deepEqual(types('S3 D3 C3 S4 H4 D4'), [TYPES.PLATE]);
  assert.deepEqual(types('S9 D9 C9 H9'), [TYPES.BOMB]);
  assert.deepEqual(types('S9 D9 C9 H9 S9 D9 C9 H9'), [TYPES.BOMB]);
  assert.deepEqual(types('X X BJ BJ'), [TYPES.JOKER_BOMB]);
  assert.ok(types('S3 S4 S5 S6 S7').includes(TYPES.STRAIGHT_FLUSH));
});

test('非法牌型', () => {
  assert.deepEqual(types('S5 D6'), []);
  assert.deepEqual(types('X BJ'), []); // 大小王不成对
  assert.deepEqual(types('S3 D4 C5 S6'), []); // 4 张不成顺
  assert.deepEqual(types('SQ DK CA S2 H3'), []); // 不能绕圈
  assert.deepEqual(types('X D3 C4 S5 H6'), []); // 王不能进顺子
  assert.deepEqual(types('S3 D4 C5 S6 H7 D8'), []); // 顺子只能 5 张
});

test('A 可作顺子两端', () => {
  assert.equal(best('SA D2 C3 S4 H5').key, 1);
  assert.equal(best('S10 DJ CQ SK HA').key, 10);
  assert.ok(types('SA DA C2 S2 H3 D3').includes(TYPES.PAIRS));
  assert.ok(types('SA DA CA S2 H2 D2').includes(TYPES.PLATE));
  assert.ok(types('SK DK CK SA HA DA').includes(TYPES.PLATE));
});

test('级牌大于 A、小于王', () => {
  const level = 7;
  const seven = best('S7', level);
  const ace = best('SA', level);
  const sj = best('X', level);
  assert.ok(canBeat(seven, ace));
  assert.ok(canBeat(sj, seven));
  // 顺子中级牌按自然位置
  assert.equal(best('S5 D6 C7 S8 D9', level).type, TYPES.STRAIGHT);
});

test('逢人配（红桃级牌）', () => {
  // 打 2：H2 为逢人配
  assert.deepEqual(types('H2 S5'), [TYPES.PAIR]);
  assert.equal(best('H2 S5').key, 5);
  assert.deepEqual(types('H2 X'), []); // 不能配王
  assert.ok(types('H2 S3 D4 C6 S7').includes(TYPES.STRAIGHT));
  assert.ok(types('H2 S9 D9 C9').includes(TYPES.BOMB));
  assert.ok(types('H2 H2 S9 D9').includes(TYPES.BOMB));
  // 同花顺补缺
  assert.ok(types('H2 S3 S4 S6 S7').includes(TYPES.STRAIGHT_FLUSH));
  // 两张逢人配本身是一对级牌
  assert.equal(best('H2 H2').key, 15);
  // 三带二多种解释
  const opts = analyze(cs('H2 S5 D5 C9 S9'), 2).filter((o) => o.type === TYPES.TRIPLE_PAIR);
  assert.deepEqual(opts.map((o) => o.key).sort((a, b) => a - b), [5, 9]);
});

test('炸弹大小顺序', () => {
  const b4 = best('S9 D9 C9 H9');
  const b5 = best('S3 D3 C3 H3 S3');
  const sf = analyze(cs('S3 S4 S5 S6 S7'), 2).find((o) => o.type === TYPES.STRAIGHT_FLUSH);
  const b6 = best('S3 D3 C3 H3 S3 D3');
  const jb = best('X X BJ BJ');
  const straight = best('S10 DJ CQ SK HA');
  assert.ok(canBeat(b4, straight));
  assert.ok(canBeat(b5, b4));
  assert.ok(canBeat(sf, b5));
  assert.ok(canBeat(b6, sf));
  assert.ok(canBeat(jb, b6));
  assert.ok(!canBeat(b4, b5));
  assert.ok(canBeat(best('SK DK CK HK'), b4));
});

test('跟牌必须同型同长', () => {
  const last = best('S5 D5');
  assert.equal(playableOptions(cs('S9 D9'), 2, last).length, 1);
  assert.equal(playableOptions(cs('S4 D4'), 2, last).length, 0);
  assert.equal(playableOptions(cs('S9'), 2, last).length, 0);
  assert.equal(playableOptions(cs('S9 D9 C9'), 2, last).length, 0);
});

test('升级数', () => {
  assert.equal(upgradeAmount([0, 2, 1, 3]), 3);
  assert.equal(upgradeAmount([0, 1, 2, 3]), 2);
  assert.equal(upgradeAmount([0, 1, 3, 2]), 1);
});

// —— 对局流程 ——
function riggedGame(hands, leader = 0) {
  const g = new Game();
  g.startRound(leader);
  g.hands = hands.map((h) => cs(h));
  return g;
}
const ids = (g, seat, n) => g.hands[seat].slice(0, n).map((x) => x.id);

test('一轮全不要后由出牌者继续出', () => {
  const g = riggedGame(['S5 S6', 'S3 S4', 'D3 D4', 'C3 C4']);
  assert.ok(g.play(0, ids(g, 0, 1)).ok);
  assert.ok(g.pass(1).ok);
  assert.ok(g.pass(2).ok);
  assert.ok(g.pass(3).ok);
  assert.equal(g.turn, 0);
  assert.equal(g.lastPlay, null);
});

test('出完牌后由队友接风', () => {
  const g = riggedGame(['SA', 'S3 S4', 'D3 D4', 'C3 C4']);
  assert.ok(g.play(0, ids(g, 0, 1)).ok);
  assert.deepEqual(g.finishOrder, [0]);
  assert.equal(g.turn, 1);
  g.pass(1); g.pass(2); g.pass(3);
  assert.equal(g.turn, 2); // 队友接风
  assert.equal(g.lastPlay, null);
});

test('非法操作被拒绝', () => {
  const g = riggedGame(['S5 D6', 'S3 S4', 'D3 D4', 'C3 C4']);
  assert.equal(g.play(1, ids(g, 1, 1)).ok, false); // 没轮到
  assert.equal(g.pass(0).ok, false); // 首出不能过
  assert.equal(g.play(0, ['nope']).ok, false);
  assert.equal(g.play(0, ids(g, 0, 2)).ok, false); // 非法牌型
});

test('双下升三级并结束本局', () => {
  const g = riggedGame(['SA', 'S3 S4', 'DA', 'C3 C4']);
  g.play(0, ids(g, 0, 1));
  g.pass(1); g.pass(2); g.pass(3);
  assert.equal(g.turn, 2);
  g.play(2, ids(g, 2, 1));
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.lastResult.up, 3);
  assert.deepEqual(g.teamLevels, [5, 2]);
  assert.ok(g.view(null).revealed);
  assert.equal(g.view(null).myHand, null);
  assert.ok(g.nextRound());
  assert.equal(g.level, 5);
  // 双下：下一局先进贡（或抗贡时头游先出）
  if (g.tribute.kind === 'resist') assert.equal(g.turn, 0);
  else assert.deepEqual(g.pendingSeats().sort(), [1, 3]);
});

test('打过 A 赢得整场', () => {
  const g = riggedGame(['SA', 'S3 S4', 'DA', 'C3 C4']);
  g.teamLevels = [14, 2];
  g.levelTeam = 0;
  g.play(0, ids(g, 0, 1));
  g.pass(1); g.pass(2); g.pass(3);
  g.play(2, ids(g, 2, 1));
  assert.equal(g.phase, 'matchOver');
  assert.equal(g.matchWinner, 0);
});

test('观战视角看不到手牌', () => {
  const g = new Game();
  g.startRound(0);
  const v = g.view(null);
  assert.equal(v.myHand, null);
  assert.equal(v.revealed, null);
  assert.deepEqual(v.handCounts, [27, 27, 27, 27]);
  assert.equal(g.view(1).myHand.length, 27);
});
