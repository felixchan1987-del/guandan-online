// 四家手牌一览（上帝视角和回放共用）：每家一个框，手牌 + 本轮出的牌
import { escapeHtml, TEAM_NAMES } from './util.js';
import { avatarHtml } from './avatar.js';
import { cardsEl } from './cards.js';

/**
 * root 里有四个 .gp-box[data-pos]（0 下 1 右 2 上 3 左）
 * o: { seats, level, viewer, hands, trick, lastSeat, highlight(seat), leftText(seat), thinking(seat), onPick(seat) }
 */
export function renderFourHands(root, o) {
  for (let seat = 0; seat < 4; seat++) {
    const box = root.querySelector(`.gp-box[data-pos="${(seat - o.viewer + 4) % 4}"]`);
    const s = o.seats[seat];
    box.classList.toggle('turn', !!o.highlight?.(seat));
    box.innerHTML =
      `<div class="gp-who">${avatarHtml(s?.avatar, s?.name || '空', { bot: s?.bot, team: seat % 2 })}` +
      `<b>${escapeHtml(s?.name || '空位')}</b><span class="team-badge t${seat % 2}">${TEAM_NAMES[seat % 2]}</span>` +
      `<span class="left-n">${o.leftText(seat)}</span></div>`;
    box.appendChild(cardsEl(o.hands?.[seat] || [], o.level, 'mini'));
    // 本轮出的牌：放在朝向中间的一侧，当前最大的一手高亮
    const t = o.trick?.[seat];
    const play = document.createElement('div');
    play.className = 'gp-play';
    if (t?.type === 'play') {
      play.appendChild(cardsEl(t.cards, o.level, 'mini'));
      const top = o.lastSeat === seat;
      play.classList.toggle('top', top);
      play.insertAdjacentHTML('beforeend', `<span class="gp-desc">${escapeHtml(t.desc)}${top ? '<i>最大</i>' : ''}</span>`);
    } else if (t?.type === 'pass') {
      play.innerHTML = '<span class="gp-pass">不要</span>';
    } else {
      play.classList.add('empty');
      play.innerHTML = `<span class="gp-desc">${o.thinking?.(seat) ? '思考中…' : ''}</span>`;
    }
    box.appendChild(play);
    box.onclick = o.onPick ? () => o.onPick(seat) : null;
    box.style.cursor = o.onPick ? '' : 'default';
  }
}
