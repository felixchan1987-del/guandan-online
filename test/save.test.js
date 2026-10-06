import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSave, decodeSave } from '../server/save.js';
import { Game } from '../server/game.js';
import { Room } from '../server/room.js';

function midGame() {
  const g = new Game();
  g.startRound(0);
  g.autoAct(0);
  g.autoAct(1);
  return g;
}

test('存档码往返：恢复后状态一致、可继续出牌', () => {
  const g = midGame();
  const code = encodeSave({ savedAt: 1, names: ['a', 'b', 'c', 'd'], game: g });
  assert.ok(code.startsWith('GD1.'));
  assert.ok(code.length < 6000, `存档码长度 ${code.length}`);
  const data = decodeSave(code);
  assert.deepEqual(data.names, ['a', 'b', 'c', 'd']);
  const back = Game.fromJSON(data.game);
  for (let s = 0; s < 4; s++) assert.deepEqual(back.view(s), g.view(s));
  const turn = back.turn;
  back.autoAct(turn);
  assert.notEqual(back.turn, turn);
});

test('存档码不泄露手牌、篡改后无法读取', () => {
  const g = midGame();
  const code = encodeSave({ savedAt: 1, names: [], game: g });
  assert.ok(!code.includes(g.hands[0][0].id));
  const chars = code.split('');
  const i = code.length - 10;
  chars[i] = chars[i] === 'A' ? 'B' : 'A';
  assert.equal(decodeSave(chars.join('')), null);
  assert.equal(decodeSave('hello'), null);
  assert.equal(decodeSave(''), null);
  // 粘贴时带了换行/空格也能读
  assert.ok(decodeSave(`  ${code.slice(0, 50)}\n${code.slice(50)} `));
});

test('暂停时不计时；继续后真人取消托管、机器人保持托管', () => {
  const room = new Room('P', () => {});
  room.game = midGame();
  room.seats = [{ playerId: 'x', name: 'x' }, null, null, null];
  room.addBot(1); room.addBot(2); room.addBot(3);
  room.game.setAuto(0, true);
  room.paused = true;
  room.schedule();
  assert.equal(room.deadline, null);
  assert.equal(room.timer, null);
  assert.ok(room.seatsOpen);
  room.resume();
  room.syncBots();
  room.schedule();
  assert.deepEqual(room.game.auto, [false, true, true, true]);
  assert.ok(room.deadline > Date.now());
  room.dispose();
});
