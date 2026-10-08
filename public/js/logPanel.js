// 出牌记录：本局按顺序谁出了什么（公开信息，玩家和观众都能看）
import { escapeHtml } from './util.js';
import { cardsEl } from './cards.js';

export function renderLog(el, log, seats, level) {
  el.innerHTML = '';
  let round = 1;
  let needHead = true;
  for (const e of log || []) {
    if (e.e) { round += 1; needHead = true; continue; }
    if (needHead) {
      el.insertAdjacentHTML('beforeend', `<div class="log-head">第 ${round} 轮</div>`);
      needHead = false;
    }
    const row = document.createElement('div');
    row.className = `log-row${e.c ? '' : ' pass'}`;
    row.innerHTML = `<b class="team${e.s % 2}">${escapeHtml(seats[e.s]?.name || '空位')}</b>`;
    if (e.c) {
      row.appendChild(cardsEl(e.c, level, 'mini'));
      row.insertAdjacentHTML('beforeend', `<span class="log-desc">${escapeHtml(e.d)}</span>`);
    } else {
      row.insertAdjacentHTML('beforeend', '<span class="log-desc">不要</span>');
    }
    el.appendChild(row);
  }
  if (!el.children.length) el.innerHTML = '<p class="muted">这一局还没有人出牌</p>';
  el.scrollTop = el.scrollHeight;
}
