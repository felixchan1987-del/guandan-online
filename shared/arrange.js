// 理牌：把手牌排成若干列（每列竖向叠放），炸弹类放在最左边
import { isWild, rankValue, SUITS, SMALL_JOKER, BIG_JOKER } from './rules.js';

const natRank = (i) => (i === 1 ? 14 : i);

/**
 * hand: 手牌；groups: 玩家手动理出的牌组（id 数组的数组）
 * mode: 'rank' 按点数分列 | 'combo' 一键理牌（拆成出牌组合，手数尽量少）
 * 返回 [{ kind, cards }]，kind: custom | jokerBomb | straightFlush | bomb | wild | rank | joker
 *   以及组合模式下的 straight | plate | pairs | triplePair | triple | pair | single
 */
export function arrangeHand(hand, level, groups = [], mode = 'rank') {
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

  // 6. 其余：组合模式拆成出牌组合，否则按点数分列（大的在左）
  if (mode === 'combo') {
    cols.push(...comboColumns(pool, level));
    return cols;
  }
  const suitOrder = { S: 0, H: 1, C: 2, D: 3, J: 4 };
  const ranks = [...new Set(pool.map((c) => c.rank))]
    .sort((a, b) => rankValue(b, level) - rankValue(a, level));
  for (const r of ranks) {
    const cards = pool.filter((c) => c.rank === r).sort((a, b) => suitOrder[a.suit] - suitOrder[b.suit]);
    cols.push({ kind: r >= SMALL_JOKER && r <= BIG_JOKER ? 'joker' : 'rank', cards });
  }
  return cols;
}

// —— 一键理牌：把剩余的牌拆成尽量少的出牌组合 ——

// 所有可能的连牌：顺子（5 张单）、三连对、钢板；序号 1 表示 A 作最小
const SEQS = [];
for (let st = 1; st <= 10; st++) SEQS.push({ kind: 'straight', start: st, width: 5, each: 1 });
for (let st = 1; st <= 12; st++) SEQS.push({ kind: 'pairs', start: st, width: 3, each: 2 });
for (let st = 1; st <= 13; st++) SEQS.push({ kind: 'plate', start: st, width: 2, each: 3 });
const seqRanks = (q) => Array.from({ length: q.width }, (_, i) => natRank(q.start + i));

/** 剩下的三张/对子/单张需要几手（三张可带一对），分数越小越好 */
function leftoverScore(counts, jokerPairs, jokerSingles) {
  let t = 0; let p = jokerPairs; let s1 = jokerSingles;
  for (let r = 2; r <= 14; r++) {
    if (counts[r] === 3) t++;
    else if (counts[r] === 2) p++;
    else if (counts[r] === 1) s1++;
  }
  const hands = t + p + s1 - Math.min(t, p);
  return hands * 10 + s1; // 手数优先，其次单张少
}

/** 在点数计数上搜索最优的连牌组合（按计数做记忆化） */
function bestSeqs(counts, jokerPairs, jokerSingles) {
  const memo = new Map();
  const solve = (c) => {
    const key = c.join(',');
    if (memo.has(key)) return memo.get(key);
    let best = { score: leftoverScore(c, jokerPairs, jokerSingles), seqs: [] };
    for (const q of SEQS) {
      const ranks = seqRanks(q);
      if (!ranks.every((r) => c[r] >= q.each)) continue;
      const next = c.slice();
      ranks.forEach((r) => { next[r] -= q.each; });
      const sub = solve(next);
      if (sub.score + 10 < best.score) best = { score: sub.score + 10, seqs: [q, ...sub.seqs] };
    }
    memo.set(key, best);
    return best;
  };
  return solve(counts).seqs;
}

function comboColumns(pool, level) {
  const val = (c) => rankValue(c.rank, level);
  const byRank = {};
  for (const c of pool) (byRank[c.rank] ||= []).push(c);
  const counts = new Array(18).fill(0);
  for (let r = 2; r <= 14; r++) counts[r] = Math.min(3, (byRank[r] || []).length);
  const jokerGroups = [SMALL_JOKER, BIG_JOKER].map((r) => byRank[r] || []).filter((g) => g.length);
  const jokerPairs = jokerGroups.filter((g) => g.length === 2).length;
  const jokerSingles = jokerGroups.filter((g) => g.length === 1).length;

  const cols = [];
  const takeRank = (r, n) => byRank[r].splice(0, n);
  for (const q of bestSeqs(counts, jokerPairs, jokerSingles)) {
    const cards = seqRanks(q).reverse().flatMap((r) => takeRank(r, q.each));
    cols.push({ kind: q.kind, cards });
  }

  // 剩余：三张、对子、单张（王的对子/单张也算在内）
  const groups = Object.values(byRank).filter((g) => g.length);
  const triples = groups.filter((g) => g.length === 3).sort((a, b) => val(b[0]) - val(a[0]));
  const pairs = groups.filter((g) => g.length === 2).sort((a, b) => val(a[0]) - val(b[0]));
  const singles = groups.filter((g) => g.length === 1).map((g) => g[0]).sort((a, b) => val(b) - val(a));
  // 三张带最小的对子，组成三带二
  for (const t of triples) {
    const p = pairs.shift();
    cols.push(p ? { kind: 'triplePair', cards: [...t, ...p] } : { kind: 'triple', cards: t });
  }
  pairs.reverse().forEach((p) => cols.push({ kind: 'pair', cards: p }));
  singles.forEach((c) => cols.push({ kind: 'single', cards: [c] }));
  return cols;
}
