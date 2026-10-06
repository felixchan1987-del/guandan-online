import {
  isWild, rankLabel, SUIT_SYMBOLS, playableOptions, describeCombo,
  tributeCandidates, returnCandidates, TYPES,
} from '/shared/rules.js';
import { findCombos } from '/shared/hint.js';
import { arrangeHand } from '/shared/arrange.js';

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

// 本浏览器保存的存档（最多 8 个）
const localSaves = {
  list() { try { return JSON.parse(store.get('gd_saves') || '[]'); } catch { return []; } },
  add(entry) { store.set('gd_saves', JSON.stringify([entry, ...this.list()].slice(0, 8))); },
  remove(code) { store.set('gd_saves', JSON.stringify(this.list().filter((e) => e.code !== code))); },
};

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
  const go = (code, query = '') => {
    const name = $('#nameInput').value.trim();
    if (name) store.set('gd_name', name);
    location.href = `/r/${code}${query}`;
  };
  const newCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  };
  $('#createBtn').onclick = () => go(newCode());
  $('#lobbyLoadBtn').onclick = () => go(newCode(), '?load=1');
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
  let groups = []; // 手动理牌的牌组（id 数组）
  let handAllowed = null; // 进贡/还贡时可选的牌
  let sfPos = -1;

  const emit = (event, data) => socket.emit(event, data, (r) => { if (r && !r.ok) toast(r.error); });

  let godView = store.get('gd_god') === '1';
  socket.on('connect', () => socket.emit('join', { roomId, playerId, name: myName, god: godView }));
  $('#godBtn').onclick = () => {
    godView = !godView;
    store.set('gd_god', godView ? '1' : '0');
    socket.emit('godView', { on: godView });
  };
  socket.on('disconnect', () => toast('连接断开，正在重连…'));
  let wantLoad = new URLSearchParams(location.search).has('load');
  socket.on('state', (s) => {
    if (wantLoad) {
      wantLoad = false;
      history.replaceState(null, '', location.pathname);
      setTimeout(openLoadPanel, 0);
    }
    const prev = state;
    state = s;
    clockOffset = s.serverNow - Date.now();
    if (s.game.roundNo !== prev?.game?.roundNo) groups = [];
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
  // —— 存档 / 读档 ——
  const panel = $('#savePanel');
  const openPanel = (mode) => {
    $('#panelTitle').textContent = mode === 'save' ? '已存档' : '读取存档';
    $('#saveResult').classList.toggle('hidden', mode !== 'save');
    $('#loadArea').classList.toggle('hidden', mode !== 'load');
    panel.classList.remove('hidden');
  };
  $('#closePanelBtn').onclick = () => panel.classList.add('hidden');
  panel.onclick = (e) => { if (e.target === panel) panel.classList.add('hidden'); };

  $('#saveBtn').onclick = () => socket.emit('save', null, (r) => {
    if (!r?.ok) return toast(r?.error || '存档失败');
    localSaves.add({ code: r.code, meta: r.meta, roomId });
    const d = new Date(r.meta.savedAt);
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([r.code], { type: 'text/plain' }));
    a.download = `guandan-save-${stamp}.txt`; // 部分浏览器不支持中文文件名
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('#savedCode').value = r.code;
    openPanel('save');
  });
  $('#copyCodeBtn').onclick = async () => {
    try { await navigator.clipboard.writeText($('#savedCode').value); toast('存档码已复制'); } catch {
      $('#savedCode').select(); toast('请手动复制');
    }
  };
  $('#pauseBtn').onclick = () => emit('pause');

  const loadCode = (code) => socket.emit('load', { code }, (r) => {
    if (!r?.ok) return toast(r?.error || '读取失败');
    panel.classList.add('hidden');
    toast('存档已读取：坐满 4 人后点「继续对局」');
  });
  function openLoadPanel() {
    const listEl = $('#localSaves');
    listEl.innerHTML = '';
    const saves = localSaves.list();
    if (!saves.length) listEl.innerHTML = '<p class="muted">本浏览器还没有存档</p>';
    for (const e of saves) {
      const m = e.meta;
      const d = new Date(m.savedAt);
      const item = document.createElement('div');
      item.className = 'save-item';
      item.innerHTML =
        `<div class="info"><b>${d.toLocaleString('zh-CN', { hour12: false })}</b><br>` +
        `第 ${m.roundNo} 局 · 蓝队 ${rankLabel(m.teamLevels[0])} · 红队 ${rankLabel(m.teamLevels[1])} · 打${TEAM_NAMES[m.levelTeam]}的级<br>` +
        `${escapeHtml(m.names.filter(Boolean).join('、'))}</div>`;
      const load = document.createElement('button');
      load.className = 'small primary';
      load.textContent = '读取';
      load.onclick = () => loadCode(e.code);
      const del = document.createElement('button');
      del.className = 'small';
      del.textContent = '删除';
      del.onclick = () => { localSaves.remove(e.code); openLoadPanel(); };
      item.append(load, del);
      listEl.appendChild(item);
    }
    $('#pasteCode').value = '';
    openPanel('load');
  }
  $('#loadCodeBtn').onclick = () => {
    const code = $('#pasteCode').value.trim();
    if (!code) return toast('请粘贴存档码');
    loadCode(code);
  };
  $('#saveFile').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) loadCode((await file.text()).trim());
  };

  $('#copyBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast('链接已复制'); } catch { toast(location.href); }
  };
  $('#renameBtn').onclick = () => {
    const n = prompt('新昵称', myName);
    if (n && n.trim()) {
      myName = n.trim().slice(0, 12);
      store.set('gd_name', myName);
      socket.emit('join', { roomId, playerId, name: myName, god: godView });
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
  $('#clearBtn').onclick = () => { selected.clear(); updateSelection(); };
  $('#hintBtn').onclick = () => {
    const g = state.game;
    if (!hintList) hintList = findCombos(g.myHand, g.level, g.lastPlay?.combo);
    if (!hintList.length) { toast('没有能管上的牌'); return; }
    hintPos = (hintPos + 1) % hintList.length;
    const h = hintList[hintPos];
    selected = new Set(h.cards.map((c) => c.id));
    const opts = playableOptions(h.cards, g.level, g.lastPlay?.combo);
    optionIndex = Math.max(0, opts.findIndex((o) => o.type === h.combo.type && o.key === h.combo.key));
    updateSelection();
  };

  // —— 理牌 ——
  $('#groupBtn').onclick = () => {
    if (!selected.size) return toast('先选中要理在一起的牌');
    groups = groups.map((g) => g.filter((id) => !selected.has(id))).filter((g) => g.length);
    groups.unshift([...selected]);
    selected.clear();
    renderHand(true);
  };
  $('#arrangeBtn').onclick = () => { groups = []; selected.clear(); renderHand(true); };
  $('#sfBtn').onclick = () => {
    const g = state.game;
    const last = g.turn === state.mySeat ? g.lastPlay?.combo : null;
    const list = findCombos(g.myHand, g.level, last).filter((h) => h.combo.type === TYPES.STRAIGHT_FLUSH);
    if (!list.length) return toast('没有同花顺');
    sfPos = (sfPos + 1) % list.length;
    selected = new Set(list[sfPos].cards.map((c) => c.id));
    optionIndex = 0;
    updateSelection();
  };

  // 点按或滑动多选
  const handEl = $('#hand');
  let drag = null;
  const applyDrag = (id) => {
    if (drag.on) selected.add(id); else selected.delete(id);
    optionIndex = 0;
    updateSelection();
  };
  handEl.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.card');
    if (!el) return;
    e.preventDefault();
    const id = el.dataset.id;
    if (handAllowed) {
      if (!handAllowed.has(id)) return;
      selected = new Set([id]);
      updateSelection();
      return;
    }
    drag = { on: !selected.has(id), seen: new Set([id]) };
    applyDrag(id);
  });
  handEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('#hand .card');
    if (el && !drag.seen.has(el.dataset.id)) {
      drag.seen.add(el.dataset.id);
      applyDrag(el.dataset.id);
    }
  });
  for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, () => { drag = null; });
  window.addEventListener('resize', () => { if (state) renderHand(true); });
  $('#autoBtn').onclick = () => emit('auto', { on: !state.game.auto[state.mySeat] });

  // —— 渲染 ——
  function cardEl(card, level, big = false) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = card.id;
    if (card.suit === 'J') {
      el.classList.add('joker', card.rank === 17 ? 'big' : 'small');
      el.innerHTML = big
        ? `<div class="lbl">${card.rank === 17 ? '大王' : '小王'}</div><div class="big-suit">★</div>`
        : (card.rank === 17 ? '<span>大</span><span>王</span>' : '<span>小</span><span>王</span>');
    } else {
      if (card.suit === 'H' || card.suit === 'D') el.classList.add('red');
      if (card.rank === level) el.classList.add('level');
      if (isWild(card, level)) { el.classList.add('wild'); el.title = '逢人配'; }
      const suit = SUIT_SYMBOLS[card.suit];
      el.innerHTML = big
        ? `<div class="lbl">${rankLabel(card.rank)}<span>${suit}</span></div><div class="big-suit">${suit}</div>`
        : `<span>${rankLabel(card.rank)}</span><span class="s">${suit}</span>`;
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
    const paused = state.paused;
    const inGame = ['tribute', 'return', 'playing'].includes(g.phase) && !paused;
    const pending = g.pending || [];
    const seatsOpen = g.phase === 'waiting' || paused;

    $('#godBtn').classList.toggle('hidden', mySeat != null);
    $('#godBtn').textContent = state.god ? '关闭上帝视角' : '上帝视角';
    $('#godBtn').classList.toggle('primary', !!state.god);
    $('#saveBtn').classList.toggle('hidden', mySeat == null || g.phase === 'waiting');
    $('#pauseBtn').classList.toggle('hidden', mySeat == null || g.phase === 'waiting' || g.phase === 'matchOver' || paused);

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
      if (seatsOpen) {
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

      // 上帝视角：观战者看到每家手牌
      if (g.allHands && g.allHands[seat]?.length) {
        const godHand = cardsEl(g.allHands[seat], g.level, 'mini god-hand');
        box.appendChild(godHand);
      }
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

    if (paused) {
      const n = seats.filter(Boolean).length;
      let html = '<span class="paused-tag">⏸ 对局已暂停</span>';
      const lf = state.loadedFrom;
      if (lf) {
        html += `<br><small>读取的存档：${new Date(lf.savedAt).toLocaleString('zh-CN', { hour12: false })}` +
          `，原玩家 ${escapeHtml(lf.names.filter(Boolean).join('、'))}</small>`;
      }
      html += `<br><small>可以换人：空位坐下或加机器人（${n}/4）</small>`;
      status.innerHTML = html;
      if (mySeat != null) {
        if (n === 4) btn('继续对局', () => emit('resume'), true);
        else btn('空位补机器人', () => emit('addBot', {}), true);
        btn('离座观战', () => emit('stand'));
      }
      btn('读取存档', openLoadPanel);
    } else if (g.phase === 'waiting') {
      const n = seats.filter(Boolean).length;
      status.textContent = n < 4 ? `等待玩家入座（${n}/4）· 把链接发给朋友，或用机器人补位` : '人已到齐';
      if (mySeat != null) {
        if (n === 4) btn('开始游戏', () => emit('start'), true);
        else btn('空位补机器人', () => emit('addBot', {}), true);
        btn('离座观战', () => emit('stand'));
      }
      btn('读取存档', openLoadPanel);
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
    const myAction = (g.pending || []).includes(me) && !state.paused;
    const tributeMode = g.phase === 'tribute' || g.phase === 'return';
    handAllowed = null;
    if (tributeMode && myAction) {
      handAllowed = new Set((g.phase === 'tribute' ? tributeCandidates(hand, g.level) : returnCandidates(hand)).map((c) => c.id));
    }

    const cols = arrangeHand(hand, g.level, groups);
    handEl.innerHTML = '';
    for (const col of cols) {
      const colEl = document.createElement('div');
      colEl.className = `col ${col.kind}`;
      for (const c of col.cards) {
        const el = cardEl(c, g.level, true);
        if (handAllowed && !handAllowed.has(c.id)) el.classList.add('dim');
        colEl.appendChild(el);
      }
      handEl.appendChild(colEl);
    }
    sizeHand(cols);
    updateSelection();
  }

  /** 按屏幕宽高计算牌的大小：尽量大，放不下时列与列重叠 */
  function sizeHand(cols) {
    const n = cols.length || 1;
    const tallest = Math.max(1, ...cols.map((c) => c.cards.length));
    const avail = handEl.clientWidth;
    const landscape = window.innerWidth > window.innerHeight;
    const maxH = window.innerHeight * (landscape && window.innerHeight < 520 ? 0.4 : 0.36);
    const STRIP = 0.52; // 叠放时每张露出的高度（相对牌宽）
    let w = Math.min(78, maxH / (1.4 + (tallest - 1) * STRIP), (avail - 3 * (n - 1)) / n);
    w = Math.max(w, 34);
    const overlap = Math.max(0, (n * w + 3 * (n - 1) - avail) / Math.max(1, n - 1));
    handEl.style.setProperty('--hw', `${Math.floor(w)}px`);
    handEl.style.setProperty('--ov', `${Math.ceil(overlap)}px`);
  }

  function updateSelection() {
    handEl.querySelectorAll('.card').forEach((el) => el.classList.toggle('selected', selected.has(el.dataset.id)));
    updateControls();
  }

  function updateControls() {
    const g = state.game;
    const hand = g.myHand;
    if (!hand) return;
    const me = state.mySeat;
    const myAction = (g.pending || []).includes(me) && !state.paused;
    const tributeMode = g.phase === 'tribute' || g.phase === 'return';

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
          b.onclick = () => { optionIndex = i; updateControls(); };
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
    $('#sfBtn').classList.toggle('hidden', tributeMode);
    $('#groupBtn').disabled = !selected.size;
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
