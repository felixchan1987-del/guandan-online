// 机器人 / 托管出牌策略（启发式）
import { findCombos } from '../shared/hint.js';
import { bombPower, isWild, TYPES } from '../shared/rules.js';

const SAME_RANK = new Set([TYPES.SINGLE, TYPES.PAIR, TYPES.TRIPLE, TYPES.TRIPLE_PAIR]);

/** 牌型强度（越大越“贵”），不同牌型大致可比 */
function strength(combo) {
  if (SAME_RANK.has(combo.type)) return combo.key - 2; // 0..15
  return combo.key + 2; // 顺子类按起点
}

/** 出这手牌的“代价”：拆炸弹、拆三张、消耗逢人配、动用炸弹 */
function cost(cand, counts, level) {
  const used = {};
  for (const c of cand.cards) if (!isWild(c, level)) used[c.rank] = (used[c.rank] || 0) + 1;
  let k = 0;
  for (const r of Object.keys(used)) {
    const have = counts[r];
    if (have - used[r] <= 0) continue;
    if (have >= 4) k += 8; // 拆炸弹
    else if (have === 3) k += 2; // 拆三张
    else if (have === 2) k += 1; // 拆对子
  }
  k += cand.wilds * 5;
  const power = bombPower(cand.combo);
  if (power) k += 10 + power;
  return k;
}

/**
 * ctx: { hand, level, seat, lastPlay, handCounts, finishOrder }
 * 返回 findCombos 的某一项，或 null 表示不出
 */
export function chooseMove(ctx) {
  const { hand, level, seat, lastPlay, handCounts, finishOrder } = ctx;
  const cands = findCombos(hand, level, lastPlay?.combo);
  if (!cands.length) return null;

  // 能一手出完就出完
  const finish = cands.find((c) => c.cards.length === hand.length);
  if (finish) return finish;

  const counts = {};
  for (const c of hand) if (!isWild(c, level)) counts[c.rank] = (counts[c.rank] || 0) + 1;
  const active = (s) => !finishOrder.includes(s);
  const opps = [(seat + 1) % 4, (seat + 3) % 4].filter(active);
  const oppMin = opps.length ? Math.min(...opps.map((s) => handCounts[s])) : 99;
  const isBomb = (c) => bombPower(c.combo) > 0;
  const nonBomb = cands.filter((c) => !isBomb(c));
  const bombs = cands.filter(isBomb);

  if (!lastPlay) {
    // 首出：先甩掉便宜的小牌，多带几张更好；对手快走完时避开他能接的牌型
    const pool = nonBomb.length ? nonBomb : cands;
    const score = (c) => {
      let s = cost(c, counts, level) + strength(c.combo) - c.cards.length * 1.5;
      if (oppMin === 1 && c.combo.type === TYPES.SINGLE) s += 20 - strength(c.combo);
      if (oppMin === 2 && c.combo.type === TYPES.PAIR) s += 12 - strength(c.combo);
      return s;
    };
    return pool.slice().sort((a, b) => score(a) - score(b))[0];
  }

  const lastSeat = lastPlay.seat;
  const partnerPlayed = (lastSeat + 2) % 4 === seat;
  if (partnerPlayed) {
    // 不压队友；除非对手马上要走完而队友已出完
    return null;
  }

  const lastCount = active(lastSeat) ? handCounts[lastSeat] : 0;
  const danger = oppMin <= 4 || lastCount <= 6;

  if (nonBomb.length) {
    const best = nonBomb.slice().sort((a, b) =>
      cost(a, counts, level) + strength(a.combo) - (cost(b, counts, level) + strength(b.combo)))[0];
    const jump = strength(best.combo) - strength(lastPlay.combo);
    // 局面不紧张时，不为小牌拆炸弹，也不急着用大牌
    if (!danger && cost(best, counts, level) >= 8) return null;
    if (!danger && jump > 6 && lastCount > 12 && hand.length > 8) return null;
    return best;
  }

  // 只能用炸弹：对手快走完、或自己快走完时才炸
  if (bombs.length && (danger || hand.length - bombs[0].cards.length <= 6)) return bombs[0];
  return null;
}

