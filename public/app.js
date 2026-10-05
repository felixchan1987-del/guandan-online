import {
  isWild, rankLabel, SUIT_SYMBOLS, playableOptions, describeCombo,
} from '/shared/rules.js';

const $ = (sel) => document.querySelector(sel);
const FINISH_NAMES = ['头游', '二游', '三游', '末游'];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 忽略 */ } },
};

let playerId = store.get('gd_pid');
if (!playerId) {
  playerId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  store.set('gd_pid', playerId);
}
let myName = store.get('gd_name') || `玩家${Math.floor(Math.random() * 900 + 100)}`;

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.add('hidden'), 1800);
}

// —— 路由 ——
const match = location.pathname.match(/^\/r\/([A-Za-z0-9]+)/);
if (!match) initLobby();
else initRoom(match[1].toUpperCase());

function initLobby() {
  $('#lobby').classList.remove('hidden');
  $('#nameInput').value = myName;
  const go = (code) => {
    const name = $('#nameInput').value.trim();
    if (name) store.set('gd_name', name);
    location.href = `/r/${code}`;
  };
  $('#createBtn').onclick = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    go(code);
  };
  $('#joinBtn').onclick = () => {
    const code = $('#codeInput').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code) go(code);
  };
}

// —— 房间 ——
function initRoom(roomId) {
  $('#room').classList.remove('hidden');
  $('#roomCode').textContent = roomId;
  document.title = `掼蛋 · ${roomId}`;

  const socket = io();
  let state = null;
  let selected = new Set();
  let optionIndex = 0;

  const emit = (event, data) => socket.emit(event, data, (r) => { if (r && !r.ok) toast(r.error); });

  socket.on('connect', () => socket.emit('join', { roomId, playerId, name: myName }));
  socket.on('disconnect', () => toast('连接断开，正在重连…'));
  socket.on('state', (s) => {
    const prevRound = state?.game?.roundNo;
    state = s;
    if (s.game.roundNo !== prevRound) selected.clear();
    // 手牌变化后丢弃已不存在的选择
    const ids = new Set((s.game.myHand || []).map((c) => c.id));
    for (const id of selected) if (!ids.has(id)) selected.delete(id);
    render();
  });

  $('#copyBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast('链接已复制'); } catch { toast(location.href); }
  };
  $('#renameBtn').onclick = () => {
    const n = prompt('新昵称', myName);
    if (n && n.trim()) {
      myName = n.trim().slice(0, 12);
      store.set('gd_name', myName);
      socket.emit('join', { roomId, playerId, name: myName });
    }
  };
  $('#playBtn').onclick = () => {
    if (!selected.size) return toast('请先选牌');
    emit('play', { cardIds: [...selected], optionIndex });
  };
  $('#passBtn').onclick = () => { selected.clear(); emit('pass'); };
  $('#clearBtn').onclick = () => { selected.clear(); render(); };

  function cardEl(card, level) {
    const el = document.createElement('div');
    el.className = 'card';
    if (card.suit === 'J') {
      el.classList.add('joker', card.rank === 17 ? 'big' : 'small');
      el.innerHTML = card.rank === 17 ? '<span>大</span><span>王</span>' : '<span>小</span><span>王</span>';
    } else {
      if (card.suit === 'H' || card.suit === 'D') el.classList.add('red');
      if (card.rank === level) el.classList.add('level');
      if (isWild(card, level)) { el.classList.add('wild'); el.title = '逢人配'; }
      el.innerHTML = `<span>${rankLabel(card.rank)}</span><span class="s">${SUIT_SYMBOLS[card.suit]}</span>`;
    }
    return el;
  }

  function cardsEl(cards, level, cls = 'mini') {
    const wrap = document.createElement('div');
    wrap.className = `cards ${cls}`;
    for (const c of cards) wrap.appendChild(cardEl(c, level));
    return wrap;
  }

  function seatName(seat) {
    const s = state.seats[seat];
    return s ? s.name : '空位';
  }

  function render() {
    const { seats, mySeat, game: g, spectators } = state;
    const viewer = mySeat ?? 0;
    const playing = g.phase === 'playing';

    $('#identity').textContent = mySeat == null ? `${myName}（观战中）` : `${myName}（${mySeat + 1} 号位）`;
    $('#levelInfo').innerHTML =
      `打 <b>${rankLabel(g.level)}</b>（${g.levelTeam === 0 ? '蓝队' : '红队'}）` +
      ` · 蓝队 ${rankLabel(g.teamLevels[0])} · 红队 ${rankLabel(g.teamLevels[1])}` +
      (g.roundNo ? ` · 第 ${g.roundNo} 局` : '');

    // 座位
    for (let seat = 0; seat < 4; seat++) {
      const pos = (seat - viewer + 4) % 4;
      const box = document.querySelector(`.seat[data-pos="${pos}"]`);
      box.innerHTML = '';
      const plate = document.createElement('div');
      plate.className = `plate team${seat % 2}`;
      if (playing && g.turn === seat) plate.classList.add('turn');
      const s = seats[seat];
      const finishIdx = g.finishOrder ? g.finishOrder.indexOf(seat) : -1;
      let meta = '';
      if (s && !s.online) meta += '<span class="offline">离线</span> ';
      if (g.handCounts) meta += `剩 ${g.handCounts[seat]} 张`;
      plate.innerHTML =
        `<div class="name">${escapeHtml(seatName(seat))}${seat === mySeat ? '（我）' : ''}</div>` +
        `<div class="meta">${meta}${finishIdx >= 0 && (playing || finishIdx < 3) ? ` <span class="rank-badge">${FINISH_NAMES[finishIdx]}</span>` : ''}</div>`;
      if (!s && g.phase === 'waiting') {
        const b = document.createElement('button');
        b.className = 'small primary';
        b.textContent = mySeat == null ? '坐下' : '换到这里';
        b.onclick = () => emit('sit', { seat });
        plate.appendChild(b);
      }
      box.appendChild(plate);

      const trick = document.createElement('div');
      trick.className = 'trick';
      const t = g.trick && g.trick[seat];
      if (g.revealed && g.revealed[seat]?.length) {
        trick.appendChild(cardsEl(g.revealed[seat], g.level));
        trick.insertAdjacentHTML('beforeend', '<div class="desc">剩余手牌</div>');
      } else if (t && t.type === 'play') {
        trick.appendChild(cardsEl(t.cards, g.level));
        trick.insertAdjacentHTML('beforeend', `<div class="desc">${t.desc}</div>`);
      } else if (t && t.type === 'pass') {
        trick.innerHTML = '<div class="pass">不出</div>';
      }
      if (pos === 0) box.prepend(trick); else box.appendChild(trick);
    }

    // 中央状态与按钮
    const status = $('#status');
    const actions = $('#centerActions');
    actions.innerHTML = '';
    const btn = (text, fn, primary) => {
      const b = document.createElement('button');
      b.textContent = text;
      if (primary) b.className = 'primary';
      b.onclick = fn;
      actions.appendChild(b);
    };

    if (g.phase === 'waiting') {
      const n = seats.filter(Boolean).length;
      status.textContent = n < 4 ? `等待玩家入座（${n}/4）· 把链接发给朋友` : '人已到齐';
      if (mySeat != null) {
        if (n === 4) btn('开始游戏', () => emit('start'), true);
        btn('离座观战', () => emit('stand'));
      }
    } else if (playing) {
      const who = g.turn === mySeat ? '轮到你' : `轮到 ${escapeHtml(seatName(g.turn))}`;
      const lead = !g.lastPlay;
      let extra = '';
      if (lead && g.lastPlay == null) extra = '（首出）';
      else if (g.lastPlay) extra = `，需压过 ${escapeHtml(seatName(g.lastPlay.seat))} 的${describeCombo(g.lastPlay.combo)}`;
      status.innerHTML = `${who}出牌${extra}`;
    } else {
      const r = g.lastResult;
      const teamName = r.winTeam === 0 ? '蓝队' : '红队';
      const list = r.finishOrder.slice(0, 4)
        .map((s, i) => `<li>${FINISH_NAMES[i]}：${escapeHtml(seatName(s))}</li>`).join('');
      status.innerHTML =
        `<div class="result-box">${g.phase === 'matchOver' ? `<b>🎉 ${teamName}打过 A，赢得整场！</b>` :
          `<b>${teamName}胜</b>，升 ${r.up} 级：${rankLabel(r.from)} → ${rankLabel(r.to)}`}<ol>${list}</ol></div>`;
      if (mySeat != null) btn(g.phase === 'matchOver' ? '再来一场' : '下一局', () => emit('nextRound'), true);
    }

    $('#spectators').textContent = spectators.length ? `观战（${spectators.length}）：${spectators.join('、')}` : '暂无观战';

    renderHand();
  }

  function renderHand() {
    const g = state.game;
    const area = $('#handArea');
    const hand = g.myHand;
    if (!hand || g.phase !== 'playing') { area.classList.add('hidden'); return; }
    area.classList.remove('hidden');

    const myTurn = g.turn === state.mySeat;
    const handEl = $('#hand');
    handEl.innerHTML = '';
    for (const c of hand) {
      const el = cardEl(c, g.level);
      if (selected.has(c.id)) el.classList.add('selected');
      el.onclick = () => {
        if (selected.has(c.id)) selected.delete(c.id); else selected.add(c.id);
        optionIndex = 0;
        renderHand();
      };
      handEl.appendChild(el);
    }

    // 多种牌型解释时让玩家选择（例如带逢人配）
    const optsEl = $('#options');
    optsEl.innerHTML = '';
    const cards = hand.filter((c) => selected.has(c.id));
    const opts = cards.length ? playableOptions(cards, g.level, g.lastPlay?.combo) : [];
    if (opts.length > 1) {
      opts.forEach((o, i) => {
        const b = document.createElement('button');
        b.className = 'small' + (i === optionIndex ? ' sel' : '');
        b.textContent = describeCombo(o);
        b.onclick = () => { optionIndex = i; renderHand(); };
        optsEl.appendChild(b);
      });
    }

    $('#playBtn').disabled = !myTurn || !opts.length;
    $('#passBtn').disabled = !myTurn || !g.lastPlay;
    $('#playBtn').textContent = cards.length && !opts.length ? (g.lastPlay ? '管不上' : '牌型不对') : '出牌';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
