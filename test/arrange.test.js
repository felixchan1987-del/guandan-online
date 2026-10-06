import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeHand } from '../shared/arrange.js';

let uid = 0;
function c(s) {
  uid++;
  if (s === 'X') return { id: `a${uid}`, suit: 'J', rank: 16 };
  if (s === 'BJ') return { id: `a${uid}`, suit: 'J', rank: 17 };
  const map = { J: 11, Q: 12, K: 13, A: 14 };
  return { id: `a${uid}`, suit: s[0], rank: map[s.slice(1)] || Number(s.slice(1)) };
}
const cs = (str) => str.split(' ').map(c);
const kinds = (cols) => cols.map((x) => x.kind);

test('炸弹、同花顺、逢人配排在左边，其余按点数从大到小', () => {
  const hand = cs('S3 D9 C9 H9 S9 D9 C4 C5 C6 C7 C8 H2 BJ SK DK S4');
  const cols = arrangeHand(hand, 2);
  assert.deepEqual(kinds(cols).slice(0, 3), ['bomb', 'straightFlush', 'wild']);
  assert.equal(cols[0].cards.length, 5); // 五张 9
  assert.deepEqual(cols[1].cards.map((x) => x.rank), [8, 7, 6, 5, 4]);
  const rest = cols.slice(3).map((x) => x.cards[0].rank);
  assert.deepEqual(rest, [17, 13, 4, 3]);
  // 所有牌都在且只出现一次
  assert.equal(cols.flatMap((x) => x.cards).length, hand.length);
});

test('天王炸单独成列；张数多的炸弹在前', () => {
  const hand = cs('X X BJ BJ S5 D5 C5 H5 S7 D7 C7 H7 S7');
  const cols = arrangeHand(hand, 2);
  assert.deepEqual(kinds(cols), ['jokerBomb', 'bomb', 'bomb']);
  assert.equal(cols[1].cards[0].rank, 7);
});

test('手动理牌的牌组排在最左，打出后自动消失', () => {
  const hand = cs('S3 D3 S9 SK');
  const groups = [[hand[3].id, hand[0].id], ['gone']];
  const cols = arrangeHand(hand, 2, groups);
  assert.equal(cols[0].kind, 'custom');
  assert.deepEqual(cols[0].cards.map((x) => x.id), [hand[3].id, hand[0].id]);
  assert.equal(cols.length, 3); // custom、9、3
  assert.equal(cols.flatMap((x) => x.cards).length, 4);
});

test('一键理牌：拆成出牌手数最少的组合', () => {
  // 3-4-5-6-7 顺子 + 9 对 + KKK 带 9 对 → 顺子、三带二 共 2 组
  const hand = cs('S3 D4 C5 S6 H7 S9 D9 SK DK CK');
  const cols = arrangeHand(hand, 2, [], 'combo');
  assert.deepEqual(kinds(cols).sort(), ['straight', 'triplePair']);
  // 钢板与三连对
  const c2 = arrangeHand(cs('S8 D8 C8 S9 D9 C9 SJ DJ SQ DQ SK DK'), 2, [], 'combo');
  assert.deepEqual(kinds(c2).sort(), ['pairs', 'plate']);
  // 按点数模式不受影响
  assert.ok(arrangeHand(hand, 2).every((x) => x.kind === 'rank'));
});

test('一键理牌：炸弹不拆、每张牌只出现一次且每组都是合法牌型', async () => {
  const { createDeck, shuffle, analyze } = await import('../shared/rules.js');
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 100; i++) {
    const hand = shuffle(createDeck(), random).slice(0, 27);
    const cols = arrangeHand(hand, 2, [], 'combo');
    const ids = cols.flatMap((x) => x.cards.map((c) => c.id));
    assert.equal(ids.length, 27);
    assert.equal(new Set(ids).size, 27);
    for (const col of cols) if (col.kind !== 'wild') assert.ok(analyze(col.cards, 2).length, col.kind);
  }
});
