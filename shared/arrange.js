// 理牌：把手牌排成若干列（每列竖向叠放），炸弹类放在最左边
import { isWild, rankValue, SUITS, SMALL_JOKER, BIG_JOKER } from './rules.js';

const natRank = (i) => (i === 1 ? 14 : i);

/**
 * hand: 手牌；groups: 玩家手动理出的牌组（id 数组的数组）
 * 返回 [{ kind, cards }]，kind: custom | jokerBomb | straightFlush | bomb | wild | rank
 */
export function arrangeHand(hand, level, groups = []) {
  const byId = new Map(hand.map((c) => [c.id, c]));
  const used = new Set();
  const cols = [];

  // 1. 手动理出的牌组
  for (const g of groups) {
    const cards = g.map((id) => byId.get(id)).filter((c) => c && !used.has(c.id));
    if (!cards.length) continue;
    cards.forEach((c) => used.add(c.id));
    cols.push({ kind: 'custom', cards });
  }
  let pool = hand.filter((c) => !used.has(c.id));
  const take = (cards, kind) => {
    const ids = new Set(cards.map((c) => c.id));
    pool = pool.filter((c) => !ids.has(c.id));
    cols.push({ kind, cards });
  };

  // 2. 天王炸
  const jokers = pool.filter((c) => c.suit === 'J');
  if (jokers.length === 4) take(jokers.sort((a, b) => b.rank - a.rank), 'jokerBomb');

  // 3. 炸弹（不含逢人配），张数多的在前
  const countOf = (r) => pool.filter((c) => c.rank === r && !isWild(c, level)).length;
  const bombRanks = [];
  for (let r = 2; r <= 14; r++) if (countOf(r) >= 4) bombRanks.push(r);
  bombRanks
    .sort((a, b) => countOf(b) - countOf(a) || rankValue(b, level) - rankValue(a, level))
    .forEach((r) => take(pool.filter((c) => c.rank === r && !isWild(c, level)), 'bomb'));

  // 4. 同花顺（不含逢人配），从大到小贪心
  for (const suit of SUITS) {
    for (let s = 10; s >= 1; s--) {
      const cards = [];
      for (let i = 4; i >= 0; i--) {
        const c = pool.find((x) => x.suit === suit && x.rank === natRank(s + i) && !isWild(x, level)
          && !cards.includes(x));
        if (!c) break;
        cards.push(c);
      }
      if (cards.length === 5) {
        take(cards, 'straightFlush');
        s += 1; // 同一起点可能还有第二副
      }
    }
  }

  // 5. 逢人配单独一列
  const wilds = pool.filter((c) => isWild(c, level));
  if (wilds.length) take(wilds, 'wild');

  // 6. 其余按点数分列，大的在左
  const suitOrder = { S: 0, H: 1, C: 2, D: 3, J: 4 };
  const ranks = [...new Set(pool.map((c) => c.rank))]
    .sort((a, b) => rankValue(b, level) - rankValue(a, level));
  for (const r of ranks) {
    const cards = pool.filter((c) => c.rank === r).sort((a, b) => suitOrder[a.suit] - suitOrder[b.suit]);
    cols.push({ kind: r >= SMALL_JOKER && r <= BIG_JOKER ? 'joker' : 'rank', cards });
  }
  return cols;
}
