// 机器人 / 托管出牌策略：基于「手牌规划」的启发式
// 每个候选出法都评估出完后剩余手牌的估值（planCost：大致是还要几手），
// 优先选不破坏牌型、让剩余手数最少的出法；炸弹和大牌留作抢回出牌权。
import { findCombos } from '../shared/hint.js';
import { planCost } from '../shared/arrange.js';
import { bombPower, rankValue, TYPES } from '../shared/rules.js';

const SAME_RANK = new Set([TYPES.SINGLE, TYPES.PAIR, TYPES.TRIPLE, TYPES.TRIPLE_PAIR]);

/** 牌型强度（越大越“贵”），不同牌型大致可比 */
function strength(combo) {
  if (SAME_RANK.has(combo.type)) return combo.key - 2; // 0..15
  return combo.key + 2; // 顺子类按起点
}

const without = (hand, cards) => {
  const ids = new Set(cards.map((c) => c.id));
  return hand.filter((c) => !ids.has(c.id));
};

/**
 * ctx: { hand, level, seat, lastPlay, handCounts, finishOrder, skill?, random? }
 * skill: 'easy' 简单（只会出最小的能出的牌）| 'normal' 普通（偶尔犯简单的错）| 'hard' 强（默认）
 * 返回 findCombos 的某一项，或 null 表示不出
 */
export function chooseMove(ctx) {
  const { hand, level, lastPlay, skill = 'hard', random = Math.random } = ctx;
  const cands = findCombos(hand, level, lastPlay?.combo);
  if (!cands.length) return null;

  // 能一手出完就出完
  const finish = cands.find((c) => c.cards.length === hand.length);
  if (finish) return finish;

  if (skill === 'easy' || (skill === 'normal' && random() < 0.35)) return simpleMove(ctx, cands, random);
  return plannedMove(ctx, cands);
}

/** 简单策略：不压队友，出最小的能出的牌；对手快走完才偶尔用炸弹 */
function simpleMove(ctx, cands, random) {
  const { seat, lastPlay, handCounts, finishOrder } = ctx;
  if (lastPlay && (lastPlay.seat + 2) % 4 === seat) return null;
  const nonBomb = cands.filter((c) => bombPower(c.combo) === 0);
  if (nonBomb.length) {
    return nonBomb.slice().sort((a, b) => strength(a.combo) - strength(b.combo) || b.cards.length - a.cards.length)[0];
  }
  const oppMin = Math.min(...[(seat + 1) % 4, (seat + 3) % 4]
    .filter((s) => !finishOrder.includes(s)).map((s) => handCounts[s]), 99);
  return oppMin <= 3 && random() < 0.6 ? cands[0] : null;
}

/** 强策略：基于手牌规划 */
function plannedMove(ctx, cands) {
  const { hand, level, seat, lastPlay, handCounts, finishOrder } = ctx;

  const active = (s) => !finishOrder.includes(s);
  const partner = (seat + 2) % 4;
  const opps = [(seat + 1) % 4, (seat + 3) % 4].filter(active);
  const oppMin = opps.length ? Math.min(...opps.map((s) => handCounts[s])) : 99;
  const partnerLeft = active(partner) ? handCounts[partner] : 0;
  const isBomb = (c) => bombPower(c.combo) > 0;
  const after = (c) => planCost(without(hand, c.cards), level);
  const base = planCost(hand, level);

  // —— 首出 ——
  if (!lastPlay) {
    // 队友快走完、对手还多：出最小的单张/对子让队友接
    if (partnerLeft && partnerLeft <= 2 && oppMin > 3) {
      const want = partnerLeft === 1 ? TYPES.SINGLE : TYPES.PAIR;
      const feed = cands.filter((c) => c.combo.type === want && !isBomb(c))
        .sort((a, b) => a.combo.key - b.combo.key)[0];
      if (feed) return feed;
    }
    const pool = cands.filter((c) => !isBomb(c));
    const list = pool.length ? pool : cands;
    const score = (c) => {
      let s = after(c) * 10 + strength(c.combo) * 0.6 - c.cards.length * 0.3 + c.wilds * 3;
      // 对手剩 1~2 张时，别出他能接的单张/对子（除非是最大的那种）
      const top = rankValue(c.cards[0].rank, level);
      if (oppMin === 1 && c.combo.type === TYPES.SINGLE && top < 16) s += 40;
      if (oppMin === 2 && c.combo.type === TYPES.PAIR && top < 15) s += 25;
      if (isBomb(c)) s += 20;
      return s;
    };
    return list.slice().sort((a, b) => score(a) - score(b))[0];
  }

  // —— 跟牌 ——
  const lastSeat = lastPlay.seat;
  if ((lastSeat + 2) % 4 === seat) return null; // 不压队友

  const lastCount = active(lastSeat) ? handCounts[lastSeat] : 0;
  const danger = oppMin <= 6 || lastCount <= 7;
  const nonBomb = cands.filter((c) => !isBomb(c));

  if (nonBomb.length) {
    // delta ≈ 这手牌是否“顺”：0 表示正好是计划里的一手，越大越伤牌型
    const scored = nonBomb.map((c) => {
      const delta = after(c) - (base - 1);
      return { c, delta, s: delta * 10 + strength(c.combo) * 0.5 + c.wilds * 4 };
    }).sort((a, b) => a.s - b.s);
    const best = scored[0];
    const jump = strength(best.c.combo) - strength(lastPlay.combo);
    if (danger) return best.c;
    if (best.delta <= 0.6 && !(jump > 7 && lastCount > 12 && hand.length > 10)) return best.c;
    // 队友还没出、而且队友手牌比我少：让队友来管
    if (best.delta <= 1.2 && !(partnerLeft && partnerLeft < hand.length)) return best.c;
    return null;
  }

  // 只能用炸弹：对手快走完，或者炸完自己三手内能走完
  const bombs = cands.filter(isBomb);
  if (bombs.length) {
    const b = bombs[0];
    if (danger || after(b) <= 3) return b;
  }
  return null;
}
