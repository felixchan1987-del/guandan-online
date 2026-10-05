// 出牌提示：从手牌中找出所有可出的组合（用于「提示」按钮和托管 AI）
import {
  isWild, rankValue, playableOptions, bombPower, TYPES, SUITS, SMALL_JOKER, BIG_JOKER,
} from './rules.js';

const natRank = (i) => (i === 1 ? 14 : i);

/**
 * 返回 [{ cards, combo, wilds }]，按从小到大排序：
 * 先非炸弹（按牌力），再炸弹（按炸弹等级）；同等情况下少用逢人配优先。
 */
export function findCombos(hand, level, lastCombo = null) {
  const wilds = hand.filter((c) => isWild(c, level));
  const nat = hand.filter((c) => !isWild(c, level));
  const w = wilds.length;
  const byRank = {};
  for (const c of nat) (byRank[c.rank] ||= []).push(c);
  const ranks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, SMALL_JOKER, BIG_JOKER]
    .sort((a, b) => rankValue(a, level) - rankValue(b, level));
  const take = (r, k, pred) => (byRank[r] || []).filter(pred || (() => true)).slice(0, k);

  const out = [];
  const seen = new Set();
  const push = (cards, prefer) => {
    const id = cards.map((c) => c.id).sort().join(',');
    if (seen.has(id + prefer)) return;
    seen.add(id + prefer);
    const opts = playableOptions(cards, level, lastCombo);
    if (!opts.length) return;
    const combo = opts.find((o) => o.type === prefer) || opts[0];
    if (prefer && combo.type !== prefer) return;
    out.push({ cards, combo, wilds: cards.filter((c) => isWild(c, level)).length });
  };

  // 跟非炸弹时只需同类型 + 炸弹；跟炸弹时只需炸弹
  const lastPower = lastCombo ? bombPower(lastCombo) : 0;
  const want = (type) => !lastCombo || (lastPower === 0 && lastCombo.type === type);

  const sameRank = (k, type) => {
    for (const r of ranks) {
      const have = take(r, k);
      if (!have.length) continue;
      if (r >= SMALL_JOKER && k > 2) continue;
      const need = k - have.length;
      if (need > w || (r >= SMALL_JOKER && need > 0)) continue;
      push(have.concat(wilds.slice(0, need)), type);
    }
  };

  if (want(TYPES.SINGLE)) {
    sameRank(1, TYPES.SINGLE);
    if (w) push([wilds[0]], TYPES.SINGLE);
  }
  if (want(TYPES.PAIR)) {
    sameRank(2, TYPES.PAIR);
    if (w === 2) push(wilds.slice(), TYPES.PAIR);
  }
  if (want(TYPES.TRIPLE)) sameRank(3, TYPES.TRIPLE);

  if (want(TYPES.TRIPLE_PAIR)) {
    for (const t of ranks) {
      if (t >= SMALL_JOKER) continue;
      const tri = take(t, 3);
      if (!tri.length || 3 - tri.length > w) continue;
      const leftW = w - (3 - tri.length);
      // 先找不用逢人配的对子，再允许补配
      for (const allowWild of [false, true]) {
        const p = ranks.find((r) => {
          if (r === t) return false;
          const have = take(r, 2).length;
          if (!have) return false;
          const need = 2 - have;
          return allowWild ? need <= leftW && (r < SMALL_JOKER || need === 0) : need === 0;
        });
        if (p != null) {
          const pair = take(p, 2);
          push(tri.concat(pair, wilds.slice(0, 5 - tri.length - pair.length)), TYPES.TRIPLE_PAIR);
          break;
        }
      }
    }
  }

  const seq = (width, each, maxStart, type, pred) => {
    for (let s = 1; s <= maxStart; s++) {
      let cards = [];
      let need = 0;
      for (let i = 0; i < width; i++) {
        const got = take(natRank(s + i), each, pred);
        cards = cards.concat(got);
        need += each - got.length;
      }
      if (need <= w && cards.length) push(cards.concat(wilds.slice(0, need)), type);
    }
  };
  if (want(TYPES.STRAIGHT)) seq(5, 1, 10, TYPES.STRAIGHT);
  if (want(TYPES.PAIRS)) seq(3, 2, 12, TYPES.PAIRS);
  if (want(TYPES.PLATE)) seq(2, 3, 13, TYPES.PLATE);

  // 炸弹类始终可以出
  for (let k = 4; k <= 8; k++) sameRank(k, TYPES.BOMB);
  for (const suit of SUITS) seq(5, 1, 10, TYPES.STRAIGHT_FLUSH, (c) => c.suit === suit);
  if ((byRank[SMALL_JOKER] || []).length === 2 && (byRank[BIG_JOKER] || []).length === 2) {
    push(byRank[SMALL_JOKER].concat(byRank[BIG_JOKER]), TYPES.JOKER_BOMB);
  }

  return out.sort((a, b) =>
    bombPower(a.combo) - bombPower(b.combo)
    || a.combo.key - b.combo.key
    || a.wilds - b.wilds
    || a.cards.length - b.cards.length);
}
