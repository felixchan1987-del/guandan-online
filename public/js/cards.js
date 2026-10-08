// 牌面元素
import { isWild, rankLabel, SUIT_SYMBOLS } from '/shared/rules.js';

export function cardEl(card, level, big = false) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = card.id;
  if (card.suit === 'J') {
    el.classList.add('joker', card.rank === 17 ? 'big' : 'small');
    el.innerHTML = big
      ? `<div class="lbl">${card.rank === 17 ? '大' : '小'}<span class="jw">王</span></div><div class="jk">JOKER</div><div class="big-suit">★</div>`
      : (card.rank === 17 ? '<span>大</span><span>王</span>' : '<span>小</span><span>王</span>');
  } else {
    if (card.suit === 'H' || card.suit === 'D') el.classList.add('red');
    if (card.rank === level) el.classList.add('level');
    if (isWild(card, level)) { el.classList.add('wild'); el.title = '逢人配'; }
    const suit = SUIT_SYMBOLS[card.suit];
    const FACE = { 11: '♝', 12: '♛', 13: '♚' };
    const center = FACE[card.rank] ? `<div class="face">${FACE[card.rank]}</div>` : `<div class="big-suit">${suit}</div>`;
    el.innerHTML = big
      ? `<div class="lbl">${card.rank === 10 ? '<i class="ten">10</i>' : rankLabel(card.rank)}<span>${suit}</span></div>${center}` +
        `<div class="corner">${rankLabel(card.rank)}${suit}</div>`
      : `<span>${rankLabel(card.rank)}</span><span class="s">${suit}</span>`;
  }
  return el;
}

export function cardsEl(cards, level, cls = 'mini') {
  const wrap = document.createElement('div');
  wrap.className = `cards ${cls}`;
  for (const c of cards) wrap.appendChild(cardEl(c, level));
  return wrap;
}
