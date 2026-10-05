// 掼蛋规则引擎（服务端与浏览器共用，纯 ES Module，无依赖）
//
// 牌的表示：{ id, suit, rank }
//   suit: 'S' 黑桃 | 'H' 红桃 | 'C' 梅花 | 'D' 方块 | 'J' 王
//   rank: 2..14（11=J 12=Q 13=K 14=A），16=小王，17=大王
// 级牌（当前打几）在单张/对子等比较中大于 A、小于小王；
// 在顺子、连对、钢板、同花顺中仍按自然位置。
// 红桃级牌为“逢人配”，可当作除大小王外的任意牌。

export const SUITS = ['S', 'H', 'C', 'D'];
export const SMALL_JOKER = 16;
export const BIG_JOKER = 17;

export const TYPES = {
  SINGLE: 'single',
  PAIR: 'pair',
  TRIPLE: 'triple',
  TRIPLE_PAIR: 'triple_pair', // 三带二
  STRAIGHT: 'straight', // 顺子（5 张）
  PAIRS: 'pairs', // 三连对（木板）
  PLATE: 'plate', // 钢板（两个连续三张）
  BOMB: 'bomb', // 4~8 张炸弹
  STRAIGHT_FLUSH: 'straight_flush', // 同花顺
  JOKER_BOMB: 'joker_bomb', // 四王
};

export const TYPE_NAMES = {
  single: '单张',
  pair: '对子',
  triple: '三张',
  triple_pair: '三带二',
  straight: '顺子',
  pairs: '三连对',
  plate: '钢板',
  bomb: '炸弹',
  straight_flush: '同花顺',
  joker_bomb: '天王炸',
};

const RANK_LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 16: '小王', 17: '大王' };
export const SUIT_SYMBOLS = { S: '♠', H: '♥', C: '♣', D: '♦', J: '' };

export function rankLabel(rank) {
  return RANK_LABELS[rank] || String(rank);
}

/** 生成两副牌共 108 张 */
export function createDeck() {
  const cards = [];
  for (let d = 0; d < 2; d++) {
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank++) {
        cards.push({ id: `${d}${suit}${rank}`, suit, rank });
      }
    }
    cards.push({ id: `${d}J16`, suit: 'J', rank: SMALL_JOKER });
    cards.push({ id: `${d}J17`, suit: 'J', rank: BIG_JOKER });
  }
  return cards;
}

export function shuffle(arr, random = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function isWild(card, level) {
  return card.suit === 'H' && card.rank === level;
}

/** 单张比较用的牌力 */
export function rankValue(rank, level) {
  if (rank === level) return 15;
  return rank;
}

/** 手牌排序用：牌力降序，逢人配排在级牌最前 */
export function sortHand(cards, level) {
  const suitOrder = { S: 0, H: 1, C: 2, D: 3, J: 4 };
  return cards.slice().sort((a, b) => {
    const va = rankValue(a.rank, level) + (isWild(a, level) ? 0.5 : 0);
    const vb = rankValue(b.rank, level) + (isWild(b, level) ? 0.5 : 0);
    if (va !== vb) return vb - va;
    return suitOrder[a.suit] - suitOrder[b.suit];
  });
}

// 顺子类牌型中，序号 1 代表 A 作为最小牌
const natRank = (i) => (i === 1 ? 14 : i);

/**
 * 找出一组牌所有合法的牌型解释。
 * 返回数组，每项 { type, key, len, desc }，key 用于同类比较。
 */
export function analyze(cards, level) {
  const n = cards.length;
  if (n === 0) return [];

  const wilds = cards.filter((c) => isWild(c, level));
  const nat = cards.filter((c) => !isWild(c, level));
  const w = wilds.length;

  const cnt = {};
  for (const c of nat) cnt[c.rank] = (cnt[c.rank] || 0) + 1;
  const natRanks = Object.keys(cnt).map(Number);
  const jokerCount = (cnt[SMALL_JOKER] || 0) + (cnt[BIG_JOKER] || 0);

  const results = [];
  const add = (type, key, extra = {}) => results.push({ type, key, len: n, ...extra });

  // —— 四王 ——
  if (n === 4 && cnt[SMALL_JOKER] === 2 && cnt[BIG_JOKER] === 2) {
    add(TYPES.JOKER_BOMB, 100);
    return results;
  }

  // —— 同点数：单张/对子/三张/炸弹 ——
  if (natRanks.length <= 1) {
    const r = natRanks.length ? natRanks[0] : level; // 全是逢人配时视为级牌
    const isJoker = r >= SMALL_JOKER;
    const ok = !isJoker || w === 0; // 逢人配不能当王
    if (ok) {
      const v = rankValue(r, level);
      if (n === 1) add(TYPES.SINGLE, v);
      else if (n === 2) add(TYPES.PAIR, v);
      else if (n === 3 && !isJoker) add(TYPES.TRIPLE, v);
      else if (n >= 4 && n <= 8 && !isJoker) add(TYPES.BOMB, v);
    }
  }

  // —— 三带二 ——
  if (n === 5) {
    const seen = new Set();
    for (let t = 2; t <= 14; t++) {
      for (const p of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, SMALL_JOKER, BIG_JOKER]) {
        if (p === t) continue;
        if ((cnt[t] || 0) + (cnt[p] || 0) !== nat.length) continue;
        const needT = 3 - (cnt[t] || 0);
        const needP = 2 - (cnt[p] || 0);
        if (needT < 0 || needP < 0 || needT + needP !== w) continue;
        if (p >= SMALL_JOKER && needP > 0) continue;
        const key = rankValue(t, level);
        if (seen.has(key)) continue;
        seen.add(key);
        add(TYPES.TRIPLE_PAIR, key, { desc: `${rankLabel(t)}带${rankLabel(p)}` });
      }
    }
  }

  // —— 顺子 / 同花顺 / 三连对 / 钢板 ——
  if (jokerCount === 0) {
    const seqTry = (width, each, maxStart, onMatch) => {
      for (let s = 1; s <= maxStart; s++) {
        const ranks = [];
        for (let i = 0; i < width; i++) ranks.push(natRank(s + i));
        let need = 0;
        let fits = true;
        for (const r of ranks) {
          const c = cnt[r] || 0;
          if (c > each) { fits = false; break; }
          need += each - c;
        }
        // 所有非逢人配的牌都必须落在序列里
        const covered = ranks.reduce((sum, r) => sum + (cnt[r] || 0), 0);
        if (fits && covered === nat.length && need === w) onMatch(s);
      }
    };

    if (n === 5) {
      const suitSet = new Set(nat.map((c) => c.suit));
      seqTry(5, 1, 10, (s) => {
        add(TYPES.STRAIGHT, s, { desc: `${rankLabel(natRank(s))}起` });
        if (suitSet.size <= 1) add(TYPES.STRAIGHT_FLUSH, s, { desc: `${rankLabel(natRank(s))}起` });
      });
    }
    if (n === 6) {
      seqTry(3, 2, 12, (s) => add(TYPES.PAIRS, s, { desc: `${rankLabel(natRank(s))}起` }));
      seqTry(2, 3, 13, (s) => add(TYPES.PLATE, s, { desc: `${rankLabel(natRank(s))}起` }));
    }
  }

  return results;
}

/** 炸弹等级：非炸弹为 0 */
export function bombPower(combo) {
  switch (combo.type) {
    case TYPES.JOKER_BOMB: return 100;
    case TYPES.STRAIGHT_FLUSH: return 5.5;
    case TYPES.BOMB: return combo.len;
    default: return 0;
  }
}

/** combo a 能否压过 combo b */
export function canBeat(a, b) {
  const pa = bombPower(a);
  const pb = bombPower(b);
  if (pa || pb) {
    if (pa !== pb) return pa > pb;
    return a.key > b.key;
  }
  return a.type === b.type && a.len === b.len && a.key > b.key;
}

/**
 * 在合法解释中选出可出的那些：
 * 首出时全部可用；跟牌时只保留能压过上家的。
 */
export function playableOptions(cards, level, lastCombo) {
  const all = analyze(cards, level);
  if (!lastCombo) return all;
  return all.filter((c) => canBeat(c, lastCombo));
}

export function describeCombo(combo) {
  if (!combo) return '';
  let name = TYPE_NAMES[combo.type];
  if (combo.type === TYPES.BOMB) name = `${combo.len}炸`;
  return combo.desc ? `${name}（${combo.desc}）` : name;
}

/** 升级数：头游队伍的队友名次 2 → 升 3，3 → 升 2，4 → 升 1 */
export function upgradeAmount(finishOrder) {
  const first = finishOrder[0];
  const partner = (first + 2) % 4;
  const pos = finishOrder.indexOf(partner);
  if (pos === 1) return 3;
  if (pos === 2) return 2;
  return 1;
}

/** 进贡可选的牌：除逢人配外牌力最大的牌 */
export function tributeCandidates(hand, level) {
  const pool = hand.filter((c) => !isWild(c, level));
  if (!pool.length) return hand.slice();
  const max = Math.max(...pool.map((c) => rankValue(c.rank, level)));
  return pool.filter((c) => rankValue(c.rank, level) === max);
}

/** 还贡可选的牌：点数 10 及以下（没有则任意牌） */
export function returnCandidates(hand) {
  const small = hand.filter((c) => c.rank <= 10);
  return small.length ? small : hand.slice();
}
