// 整局回放：从起手牌开始逐手播放，四家手牌全部可见
import { replayFrames } from '/shared/replay.js';
import { $, escapeHtml, FINISH_NAMES } from './util.js';
import { renderFourHands } from './fourHands.js';

let rp = null; // { frames, i, timer, data }

const stop = () => {
  clearInterval(rp?.timer);
  if (rp) rp.timer = null;
  $('#rpPlay').textContent = '▶';
};

function draw() {
  const { frames, i, data } = rp;
  const f = frames[i];
  const name = (seat) => data.seats[seat]?.name || '空位';
  renderFourHands($('#rpAll'), {
    seats: data.seats, level: data.level, viewer: data.viewer, hands: f.hands, trick: f.trick,
    lastSeat: f.pass ? null : f.seat,
    highlight: (seat) => seat === f.seat,
    leftText: (seat) => {
      const fi = f.finished.indexOf(seat);
      return fi >= 0 ? `<span class="done">${FINISH_NAMES[fi]}</span>` : `剩 ${f.hands[seat].length} 张`;
    },
  });
  const what = f.seat == null ? '起手牌' : `${escapeHtml(name(f.seat))} ${f.pass ? '不要' : escapeHtml(f.desc)}`;
  $('#rpNow').innerHTML = `第 ${i}/${frames.length - 1} 手 · ${what}`;
  $('#rpMidType').textContent = f.seat == null ? '开局' : f.pass ? '不要' : f.desc;
  $('#rpMidSub').textContent = f.seat == null ? '起手牌' : name(f.seat);
  $('#rpRange').value = String(i);
}

const go = (i) => {
  rp.i = Math.max(0, Math.min(rp.frames.length - 1, i));
  draw();
  if (rp.i === rp.frames.length - 1) stop();
};

/** data: { startHands, log, level, seats, viewer, title } */
export function openReplay(data) {
  if (!data?.startHands) return false;
  stop();
  rp = { frames: replayFrames(data.startHands, data.log), i: 0, timer: null, data };
  $('#rpTitle').textContent = data.title || '本局回放';
  $('#rpRange').max = String(rp.frames.length - 1);
  $('#replayPanel').classList.remove('hidden');
  draw();
  return true;
}

export function initReplayView() {
  $('#rpClose').onclick = () => { stop(); $('#replayPanel').classList.add('hidden'); };
  $('#rpFirst').onclick = () => { stop(); go(0); };
  $('#rpPrev').onclick = () => { stop(); go(rp.i - 1); };
  $('#rpNext').onclick = () => { stop(); go(rp.i + 1); };
  $('#rpLast').onclick = () => { stop(); go(rp.frames.length - 1); };
  $('#rpRange').oninput = (e) => { stop(); go(Number(e.target.value)); };
  $('#rpPlay').onclick = () => {
    if (rp.timer) return stop();
    if (rp.i >= rp.frames.length - 1) go(0);
    $('#rpPlay').textContent = '⏸';
    rp.timer = setInterval(() => go(rp.i + 1), 900);
  };
}
