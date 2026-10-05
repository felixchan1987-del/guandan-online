import {
  isWild, rankLabel, SUIT_SYMBOLS, playableOptions, describeCombo,
  tributeCandidates, returnCandidates,
} from '/shared/rules.js';
import { findCombos } from '/shared/hint.js';

const $ = (sel) => document.querySelector(sel);
const FINISH_NAMES = ['头游', '二游', '三游', '末游'];
const TEAM_NAMES = ['蓝队', '红队'];

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cardText(card) {
  if (card.suit === 'J') return card.rank === 17 ? '大王' : '小王';
  return `${SUIT_SYMBOLS[card.suit]}${rankLabel(card.rank)}`;
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
  let clockOffset = 0; // 服务器时间 - 本地时间
  let selected = new Set();
  let optionIndex = 0;
  let hintList = null;
  let hintPos = -1;
  let unread = 0;

  const emit = (event, data) => socket.emit(event, data, (r) => { if (r && !r.ok) toast(r.error); });

  socket.on('connect', () => socket.emit('join', { roomId, playerId, name: myName }));
  socket.on('disconnect', () => toast('连接断开，正在重连…'));
  socket.on('state', (s) => {
    const prev = state;
    state = s;
    clockOffset = s.serverNow - Date.now();
    if (s.game.roundNo !== prev?.game?.roundNo || s.game.phase !== prev?.game?.phase) selected.clear();
    // 手牌变化后丢弃已不存在的选择
    const ids = new Set((s.game.myHand || []).map((c) => c.id));
    for (const id of selected) if (!ids.has(id)) selected.delete(id);
    hintList = null;
    render();
  });

  // —— 聊天 ——
  const chatLog = $('#chatLog');
  function addChat(m) {
    const div = document.createElement('div');
    const who = m.seat == null ? `${m.name}（观战）` : m.name;
    div.innerHTML = `<b class="${m.seat == null ? '' : `team${m.seat % 2}`}">${escapeHtml(who)}</b>：${escapeHtml(m.text)}`;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  socket.on('chatHistory', (list) => { chatLog.innerHTML = ''; list.forEach(addChat); });
  socket.on('chat', (m) => {
    addChat(m);
    if ($('#chatPanel').classList.contains('hidden')) {
      unread += 1;
      $('#chatBtn').textContent = `聊天（${unread}）`;
    }
  });
  $('#chatBtn').onclick = () => {
    $('#chatPanel').classList.toggle('hidden');
    unread = 0;
    $('#chatBtn').textContent = '聊天';
    chatLog.scrollTop = chatLog.scrollHeight;
  };
  $('#chatForm').onsubmit = (e) => {
    e.preventDefault();
    const input = $('#chatInput');
    if (input.value.trim()) emit('chat', { text: input.value });
    input.value = '';
  };
  document.querySelectorAll('.quick').forEach((b) => { b.onclick = () => emit('chat', { text: b.textContent }); });

  // —— 顶部按钮 ——
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

  // —— 出牌操作 ——
  $('#playBtn').onclick = () => {
    const g = state.game;
    if (!selected.size) return toast('请先选牌');
    if (g.phase === 'tribute' || g.phase === 'return') emit('tribute', { cardId: [...selected][0] });
    else emit('play', { cardIds: [...selected], optionIndex });
  };
  $('#passBtn').onclick = () => { selected.clear(); emit('pass'); };
  $('#clearBtn').onclick = () => { selected.clear(); renderHand(); };
  $('#hintBtn').onclick = () => {
    const g = state.game;
    if (!hintList) hintList = findCombos(g.myHand, g.level, g.lastPlay?.combo);
    if (!hintList.length) { toast('没有能管上的牌'); return; }
    hintPos = (hintPos + 1) % hintList.length;
    const h = hintList[hintPos];
    selected = new Set(h.cards.map((c) => c.id));
    const opts = playableOptions(h.cards, g.level, g.lastPlay?.combo);
    optionIndex = Math.max(0, opts.findIndex((o) => o.type === h.combo.type && o.key === h.combo.key));
    renderHand(true);
  };
  $('#autoBtn').onclick = () => emit('auto', { on: !state.game.auto[state.mySeat] });

  // —— 渲染 ——
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

  const seatName = (seat) => (state.seats[seat] ? state.seats[seat].name : '空位');
  const nameHtml = (seat) => escapeHtml(seatName(seat));

  function render() {
    const { seats, mySeat, game: g, spectators } = state;
    const viewer = mySeat ?? 0;
    const inGame = ['tribute', 'return', 'playing'].includes(g.phase);
    const pending = g.pending || [];

    $('#identity').textContent = mySeat == null ? `${myName}（观战中）` : `${myName}（${mySeat + 1} 号位）`;
    const aInfo = [0, 1].filter((t) => g.aFails?.[t]).map((t) => ` · ${TEAM_NAMES[t]}打A失败${g.aFails[t]}次`).join('');
    $('#levelInfo').innerHTML =
      `打 <b>${rankLabel(g.level)}</b>（${TEAM_NAMES[g.levelTeam]}）` +
      ` · 蓝队 ${rankLabel(g.teamLevels[0])} · 红队 ${rankLabel(g.teamLevels[1])}` +
      (g.roundNo ? ` · 第 ${g.roundNo} 局` : '') + aInfo;

    // 座位
    for (let seat = 0; seat < 4; seat++) {
      const pos = (seat - viewer + 4) % 4;
      const box = document.querySelector(`.seat[data-pos="${pos}"]`);
      box.innerHTML = '';
      const plate = document.createElement('div');
      plate.className = `plate team${seat % 2}`;
      if (inGame && pending.includes(seat)) plate.classList.add('turn');
      const s = seats[seat];
      const finishIdx = g.finishOrder ? g.finishOrder.indexOf(seat) : -1;
      const tags = [];
      if (s && !s.online) tags.push('<span class="offline">离线</span>');
      if (s?.bot) tags.push('<span class="bot-tag">机器人</span>');
      else if (inGame && g.auto[seat]) tags.push('<span class="auto-tag">托管</span>');
      if (g.handCounts) tags.push(`剩 ${g.handCounts[seat]} 张`);
      if (finishIdx >= 0 && (g.phase === 'playing' || finishIdx < 3)) tags.push(`<span class="rank-badge">${FINISH_NAMES[finishIdx]}</span>`);
      if (inGame && pending.includes(seat)) tags.push(`<span class="timer" data-seat="${seat}"></span>`);
      plate.innerHTML =
        `<div class="name">${s?.bot ? '🤖' : ''}${nameHtml(seat)}${seat === mySeat ? '（我）' : ''}</div>` +
        `<div class="meta">${tags.join(' ')}</div>`;
      if (g.phase === 'waiting') {
        const seatBtn = (text, fn, cls = 'small') => {
          const b = document.createElement('button');
          b.className = cls;
          b.textContent = text;
          b.onclick = fn;
          plate.appendChild(b);
        };
        if (!s) {
          seatBtn(mySeat == null ? '坐下' : '换到这里', () => emit('sit', { seat }), 'small primary');
          if (mySeat != null) seatBtn('加机器人', () => emit('addBot', { seat }));
        } else if (s.bot && mySeat != null) {
          seatBtn('移除', () => emit('removeBot', { seat }));
        }
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
      status.textContent = n < 4 ? `等待玩家入座（${n}/4）· 把链接发给朋友，或用机器人补位` : '人已到齐';
      if (mySeat != null) {
        if (n === 4) btn('开始游戏', () => emit('start'), true);
        else btn('空位补机器人', () => emit('addBot', {}), true);
        btn('离座观战', () => emit('stand'));
      }
    } else if (g.phase === 'tribute') {
      const names = pending.map(nameHtml).join('、');
      status.innerHTML = pending.includes(mySeat)
        ? '<b>请进贡</b>：选择一张最大的牌（逢人配除外）'
        : `等待 ${names} 进贡`;
    } else if (g.phase === 'return') {
      status.innerHTML = pending.includes(mySeat)
        ? '<b>请还贡</b>：选择一张 10 及以下的牌'
        : `等待 ${pending.map(nameHtml).join('、')} 还贡`;
    } else if (g.phase === 'playing') {
      const who = g.turn === mySeat ? '轮到你' : `轮到 ${nameHtml(g.turn)} `;
      const extra = g.lastPlay
        ? `，需压过 ${nameHtml(g.lastPlay.seat)} 的${describeCombo(g.lastPlay.combo)}`
        : '（首出）';
      status.innerHTML = `${who}出牌${extra}`;
    } else {
      const r = g.lastResult;
      const teamName = TEAM_NAMES[r.winTeam];
      const list = r.finishOrder.slice(0, 4)
        .map((s, i) => `<li>${FINISH_NAMES[i]}：${nameHtml(s)}</li>`).join('');
      let head = g.phase === 'matchOver'
        ? `<b>🎉 ${teamName}打过 A，赢得整场！</b>`
        : `<b>${teamName}胜</b>，升 ${r.up} 级：${rankLabel(r.from)} → ${rankLabel(r.to)}`;
      if (r.aFail) {
        head += `<br>${TEAM_NAMES[r.aFail.team]}打 A 失败（第 ${r.aFail.count} 次）` +
          (r.aFail.dropped ? '，退回打 2' : '');
      }
      status.innerHTML = `<div class="result-box">${head}<ol>${list}</ol></div>`;
      if (mySeat != null) btn(g.phase === 'matchOver' ? '再来一场' : '下一局', () => emit('nextRound'), true);
    }

    // 进贡信息
    const tInfo = $('#tributeInfo');
    tInfo.innerHTML = '';
    if (g.tribute && inGame) {
      if (g.tribute.kind === 'resist') {
        tInfo.textContent = `抗贡！${g.tribute.payers.map(seatName).join('、')} 持有两张大王，免进贡`;
      } else {
        tInfo.innerHTML = g.tribute.entries.map((e) => {
          let txt = `${nameHtml(e.from)} 进贡${e.card ? ` <b>${cardText(e.card)}</b>` : (e.paid ? '（已选）' : '')}`;
          if (e.to != null) txt += ` 给 ${nameHtml(e.to)}`;
          if (e.back) txt += `，还贡 <b>${cardText(e.back)}</b>`;
          return txt;
        }).join('；');
      }
    }

    $('#spectators').textContent = spectators.length ? `观战（${spectators.length}）：${spectators.join('、')}` : '暂无观战';

    renderHand();
    updateTimers();
  }

  function renderHand(keepHint) {
    const g = state.game;
    const area = $('#handArea');
    const hand = g.myHand;
    const inGame = ['tribute', 'return', 'playing'].includes(g.phase);
    if (!hand || !inGame) { area.classList.add('hidden'); return; }
    area.classList.remove('hidden');
    if (!keepHint) { hintList = null; hintPos = -1; }

    const me = state.mySeat;
    const myAction = (g.pending || []).includes(me);
    const tributeMode = g.phase === 'tribute' || g.phase === 'return';
    let allowed = null;
    if (tributeMode && myAction) {
      allowed = new Set((g.phase === 'tribute' ? tributeCandidates(hand, g.level) : returnCandidates(hand)).map((c) => c.id));
    }

    const handEl = $('#hand');
    handEl.innerHTML = '';
    for (const c of hand) {
      const el = cardEl(c, g.level);
      if (selected.has(c.id)) el.classList.add('selected');
      if (allowed && !allowed.has(c.id)) el.classList.add('dim');
      el.onclick = () => {
        if (allowed) {
          if (!allowed.has(c.id)) return;
          selected = new Set([c.id]);
        } else if (selected.has(c.id)) selected.delete(c.id);
        else selected.add(c.id);
        optionIndex = 0;
        renderHand();
      };
      handEl.appendChild(el);
    }

    // 多种牌型解释时让玩家选择（例如带逢人配）
    const optsEl = $('#options');
    optsEl.innerHTML = '';
    const cards = hand.filter((c) => selected.has(c.id));
    let canPlay;
    if (tributeMode) {
      canPlay = myAction && cards.length === 1;
      $('#playBtn').textContent = g.phase === 'tribute' ? '进贡' : '还贡';
    } else {
      const opts = cards.length ? playableOptions(cards, g.level, g.lastPlay?.combo) : [];
      if (opts.length > 1) {
        opts.forEach((o, i) => {
          const b = document.createElement('button');
          b.className = 'small' + (i === optionIndex ? ' sel' : '');
          b.textContent = describeCombo(o);
          b.onclick = () => { optionIndex = i; renderHand(true); };
          optsEl.appendChild(b);
        });
      }
      canPlay = myAction && opts.length > 0;
      $('#playBtn').textContent = cards.length && !opts.length ? (g.lastPlay ? '管不上' : '牌型不对') : '出牌';
    }

    $('#playBtn').disabled = !canPlay;
    $('#passBtn').classList.toggle('hidden', tributeMode);
    $('#hintBtn').classList.toggle('hidden', tributeMode);
    $('#passBtn').disabled = !myAction || !g.lastPlay;
    $('#hintBtn').disabled = !myAction;
    const auto = g.auto[me];
    $('#autoBtn').textContent = auto ? '取消托管' : '托管';
    $('#autoBtn').classList.toggle('primary', auto);
  }

  function updateTimers() {
    if (!state || !state.deadline) return;
    const left = Math.max(0, Math.ceil((state.deadline - (Date.now() + clockOffset)) / 1000));
    document.querySelectorAll('.timer').forEach((el) => {
      el.textContent = `⏱${left}`;
      el.classList.toggle('urgent', left <= 5);
    });
  }
  setInterval(updateTimers, 500);
}
