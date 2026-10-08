// 回放：由起手牌 + 出牌记录还原每一步的局面（前后端共用）

/**
 * startHands: 四家起手牌；log: Game.log
 * 返回帧数组：第 0 帧为起手，之后每个动作一帧
 * 帧：{ hands, trick, seat, desc, pass, finished }
 */
export function replayFrames(startHands, log) {
  let hands = startHands.map((h) => h.slice());
  let trick = [null, null, null, null];
  const finished = [];
  const frames = [{ hands, trick, seat: null, desc: '起手牌', pass: false, finished: [] }];
  let fresh = false; // 上一轮刚结束，下一手开始前清桌
  for (const e of log || []) {
    if (e.e) { fresh = true; continue; }
    trick = fresh ? [null, null, null, null] : trick.slice();
    fresh = false;
    if (e.c) {
      const ids = new Set(e.c.map((c) => c.id));
      hands = hands.slice();
      hands[e.s] = hands[e.s].filter((c) => !ids.has(c.id));
      trick[e.s] = { type: 'play', cards: e.c, desc: e.d };
      if (!hands[e.s].length && !finished.includes(e.s)) finished.push(e.s);
    } else {
      trick[e.s] = { type: 'pass' };
    }
    frames.push({ hands, trick, seat: e.s, desc: e.c ? e.d : '不要', pass: !e.c, finished: finished.slice() });
  }
  return frames;
}
