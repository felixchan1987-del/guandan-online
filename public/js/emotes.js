// 互动表情：点别人的头像丢鲜花、鸡蛋等，所有人都能看到飞过去的动画
import { $, toast } from './util.js';
import { settings } from './settings.js';

const EMO = { flower: '🌹', like: '👍', beer: '🍺', egg: '🥚', bomb: '💣' };
const HIT = { flower: '💐', like: '👍', beer: '🍻', egg: '🍳', bomb: '💥' };

/**
 * o: { socket, plateOf(seat) -> 元素, canView: () => bool, onView(seat) }
 */
export function initEmotes(o) {
  const pop = $('#emotePop');
  let target = null;
  const close = () => { pop.classList.add('hidden'); target = null; };

  pop.querySelectorAll('[data-emote]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      if (target == null) return;
      o.socket.emit('emote', { to: target, kind: b.dataset.emote }, (r) => { if (r && !r.ok) toast(r.error); });
      close();
    };
  });
  $('#emoteView').onclick = (e) => {
    e.stopPropagation();
    if (target != null) o.onView(target);
    close();
  };
  document.addEventListener('pointerdown', (e) => {
    if (!pop.classList.contains('hidden') && !pop.contains(e.target)) close();
  }, true);

  o.socket.on('emote', ({ from, to, kind }) => fly(from, to, kind));

  function fly(from, to, kind) {
    const dst = o.plateOf(to)?.querySelector('.av-wrap') || o.plateOf(to);
    if (!dst || !EMO[kind]) return;
    const src = from == null ? null : (o.plateOf(from)?.querySelector('.av-wrap') || o.plateOf(from));
    const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const [x1, y1] = src ? center(src) : [innerWidth / 2, innerHeight - 40];
    const [x2, y2] = center(dst);
    const el = document.createElement('div');
    el.className = 'emote-fly';
    el.textContent = EMO[kind];
    el.style.left = `${x1}px`;
    el.style.top = `${y1}px`;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transform = `translate(${x2 - x1}px, ${y2 - y1}px) rotate(${kind === 'egg' || kind === 'bomb' ? 540 : 0}deg)`;
    }));
    setTimeout(() => {
      el.textContent = HIT[kind];
      el.classList.add('hit');
      if (settings.sound === 'on') ping(kind);
    }, 650);
    setTimeout(() => el.remove(), 1700);
  }

  return {
    /** 点了某个座位的头像：弹出表情选择（观战者另有「看他的视角」） */
    open(seat, anchor) {
      target = seat;
      $('#emoteView').classList.toggle('hidden', !o.canView());
      pop.classList.remove('hidden');
      const r = anchor.getBoundingClientRect();
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
      pop.style.top = `${r.bottom + h + 8 < innerHeight ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
    },
  };
}

// 命中时的小音效
let ac = null;
function ping(kind) {
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator();
    const g = ac.createGain();
    const t = ac.currentTime;
    const f = { egg: 180, bomb: 90, beer: 520, flower: 880, like: 660 }[kind];
    o.type = kind === 'bomb' || kind === 'egg' ? 'sawtooth' : 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * (kind === 'bomb' ? 0.4 : 1.5), t + 0.2);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + 0.3);
  } catch { /* 忽略 */ }
}
