import {
  isWild, rankLabel, SUIT_SYMBOLS, playableOptions, describeCombo,
  tributeCandidates, returnCandidates, TYPES, TYPE_NAMES, bombPower,
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

// —— 头像 ——
/** 把用户选的图片居中裁成正方形、压缩成 128px JPEG（约 5~10KB） */
function makeAvatar(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 128;
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(img,
        (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = URL.createObjectURL(file);
  });
}

/** 选图片 → 压缩 → 存本地，返回 data URL */
function pickAvatar() {
  return new Promise((resolve) => {
    const input = $('#avatarFile');
    input.value = '';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      try {
        const dataUrl = await makeAvatar(file);
        store.set('gd_avatar', dataUrl);
        resolve(dataUrl);
      } catch (e) {
        toast(e.message);
        resolve(null);
      }
    };
    input.click();
  });
}

/** 头像 HTML：有图片用图片，机器人用 🤖，否则用名字首字 */
function avatarHtml(src, name, { bot = false, team = null, cls = '' } = {}) {
  const t = team == null ? '' : ` team${team}`;
  if (src) return `<img class="avatar${t} ${cls}" src="${escapeHtml(src)}" alt="">`;
  const ch = bot ? '🤖' : escapeHtml(Array.from(String(name || '?').trim())[0] || '?');
  return `<span class="avatar letter${t} ${cls}">${ch}</span>`;
}

function cardText(card) {
  if (card.suit === 'J') return card.rank === 17 ? '大王' : '小王';
  return `${SUIT_SYMBOLS[card.suit]}${rankLabel(card.rank)}`;
}

// —— 设置（保存在本浏览器） ——
const SETTINGS_DEFAULT = { cardSize: 'm', theme: 'blue', sound: 'on', confirm: 'off' };
const settings = { ...SETTINGS_DEFAULT };
try { Object.assign(settings, JSON.parse(store.get('gd_settings') || '{}')); } catch { /* 忽略 */ }
const saveSettings = () => store.set('gd_settings', JSON.stringify(settings));
const applyTheme = () => { document.documentElement.dataset.theme = settings.theme; };
applyTheme();

// —— 音效：用 Web Audio 现场合成，不需要音频文件 ——
const sfx = (() => {
  let ctx = null;
  const ac = () => {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  const tone = (freq, dur, { type = 'sine', vol = 0.15, delay = 0, slide = 0 } = {}) => {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  };
  const noise = (dur, vol, cutoff = 1200) => {
    const c = ac();
    if (!c) return;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const src = c.createBufferSource();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    src.buffer = buf;
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.value = vol;
    src.connect(f).connect(g).connect(c.destination);
    src.start();
  };
  const on = () => settings.sound === 'on';
  return {
    unlock() { if (on()) ac(); },
    play() { if (on()) { noise(0.06, 0.35, 3000); tone(420, 0.06, { type: 'triangle', vol: 0.12 }); } },
    pass() { if (on()) tone(320, 0.08, { vol: 0.08 }); },
    bomb() { if (on()) { noise(0.7, 0.9, 900); tone(150, 0.6, { type: 'sawtooth', vol: 0.22, slide: -100 }); } },
    turn() { if (on()) { tone(660, 0.12, { vol: 0.12 }); tone(990, 0.18, { vol: 0.12, delay: 0.12 }); } },
    tick() { if (on()) tone(1200, 0.04, { type: 'square', vol: 0.05 }); },
    win() { if (on()) [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, { vol: 0.13, delay: i * 0.12 })); },
    lose() { if (on()) [392, 330, 262].forEach((f, i) => tone(f, 0.25, { vol: 0.1, delay: i * 0.15 })); },
  };
})();
document.addEventListener('pointerdown', () => sfx.unlock());

// —— 最近去过的房间 ——
const recentRooms = {
  list() { try { return JSON.parse(store.get('gd_recent') || '[]'); } catch { return []; } },
  add(code) {
    const list = this.list().filter((r) => r.code !== code);
    store.set('gd_recent', JSON.stringify([{ code, t: Date.now() }, ...list].slice(0, 5)));
  },
};

// 可安装为手机桌面应用（PWA）
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// —— 路由 ——
const match = location.pathname.match(/^\/r\/([A-Za-z0-9]+)/);
if (!match) initLobby();
else initRoom(match[1].toUpperCase());

function initLobby() {
  $('#lobby').classList.remove('hidden');
  $('#nameInput').value = myName;
  const showAvatar = () => {
    $('#lobbyAvatar').innerHTML = avatarHtml(store.get('gd_avatar'), $('#nameInput').value || myName, { cls: 'big' });
  };
  showAvatar();
  $('#lobbyAvatarBtn').onclick = async () => { if (await pickAvatar()) showAvatar(); };
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
  $('#practiceBtn').onclick = () => go(newCode(), '?practice=1');
  const recent = recentRooms.list();
  if (recent.length) {
    const ago = (t) => {
      const m = Math.round((Date.now() - t) / 60000);
      return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`;
    };
    $('#recentRooms').innerHTML = '<div class="rt">最近的房间</div>';
    for (const r of recent) {
      const b = document.createElement('button');
      b.innerHTML = `<span>房间 <b>${escapeHtml(r.code)}</b></span><small>${ago(r.t)}</small>`;
      b.onclick = () => go(r.code);
      $('#recentRooms').appendChild(b);
    }
  }
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
  let arrangeMode = store.get('gd_arrange') === 'combo' ? 'combo' : 'rank'; // 按点数 | 一键理牌（按组合）
  let handAllowed = null; // 进贡/还贡时可选的牌
  let sfPos = -1;

  const emit = (event, data) => socket.emit(event, data, (r) => { if (r && !r.ok) toast(r.error); });

  const sendAvatar = () => {
    const dataUrl = store.get('gd_avatar');
    if (dataUrl) socket.emit('avatar', { dataUrl }, (r) => { if (r && !r.ok) toast(r.error); });
  };
  // 上帝视角：null 关闭 | 'all' 所有玩家 | 'one' 指定玩家
  let godMode = null;
  let godSeat = 0;
  socket.on('connect', () => socket.emit('join', { roomId, playerId, name: myName, god: !!godMode }, sendAvatar));
  // 观战视角：看哪一家（该家显示在下方）
  let viewSeat = Number(store.get('gd_view')) || 0;
  const setView = (seat) => {
    viewSeat = seat;
    store.set('gd_view', String(seat));
    render();
  };

  const show = (id) => $(id).classList.remove('hidden');
  const hide = (id) => $(id).classList.add('hidden');
  // 点遮罩或「取消」关闭弹层
  for (const id of ['#moreMenu', '#godMenu', '#godExit']) {
    $(id).addEventListener('click', (e) => { if (e.target.id === id.slice(1) || e.target.closest('.cancel')) hide(id); });
  }

  // —— 上帝视角 ——
  const setGod = (mode, seat) => {
    const wasOn = !!godMode;
    godMode = mode;
    if (seat != null) godSeat = seat;
    if (!!mode !== wasOn) socket.emit('godView', { on: !!mode });
    hide('#godMenu');
    if (mode) { show('#godPanel'); renderGod(); } else hide('#godPanel');
    if (!mode && wasOn) show('#godExit');
  };
  $('#godFab').onclick = () => show('#godMenu');
  document.querySelectorAll('#godMenu [data-god]').forEach((b) => {
    b.onclick = () => {
      const m = b.dataset.god;
      if (m === 'off') { if (godMode) setGod(null); else hide('#godMenu'); return; }
      setGod(m, m === 'one' ? viewSeat : null);
    };
  });
  $('#gpClose').onclick = () => setGod(null);
  $('#gpBack').onclick = () => setGod('all');
  $('#godExitOk').onclick = () => hide('#godExit');
  const stepGod = (d) => { godSeat = (godSeat + d + 4) % 4; renderGod(); };
  $('#gpPrev').onclick = () => stepGod(-1);
  $('#gpNext').onclick = () => stepGod(1);
  // 左右滑动切换玩家
  let swipeX = null;
  $('#gpCard').addEventListener('pointerdown', (e) => { swipeX = e.clientX; });
  $('#gpCard').addEventListener('pointerup', (e) => {
    if (swipeX == null) return;
    const dx = e.clientX - swipeX;
    swipeX = null;
    if (Math.abs(dx) > 40) stepGod(dx < 0 ? 1 : -1);
  });

  // —— 更多菜单 ——
  $('#backBtn').onclick = () => { location.href = '/'; };
  $('#moreBtn').onclick = () => {
    const me = state?.mySeat;
    $('#moreAvatar').innerHTML = avatarHtml(store.get('gd_avatar'), myName, { team: me == null ? null : me % 2 });
    $('#moreName').textContent = myName;
    $('#moreRole').textContent = me == null ? '观战中' : `${me + 1} 号位 · ${TEAM_NAMES[me % 2]}`;
    const g = state?.game;
    const playing = me != null && g && g.phase !== 'waiting';
    const vis = (act, on) => $(`#moreMenu [data-act="${act}"]`).classList.toggle('hidden', !on);
    vis('pause', playing && !state.paused && g.phase !== 'matchOver');
    vis('save', playing);
    vis('load', !!g && (g.phase === 'waiting' || state.paused));
    show('#moreMenu');
  };
  document.querySelectorAll('#moreMenu [data-act]').forEach((b) => {
    b.onclick = async () => {
      hide('#moreMenu');
      const act = b.dataset.act;
      if (act === 'rename') rename();
      else if (act === 'avatar') { if (await pickAvatar()) sendAvatar(); }
      else if (act === 'pause') emit('pause');
      else if (act === 'save') saveGame();
      else if (act === 'load') openLoadPanel();
      else if (act === 'settings') openSettings();
      else if (act === 'lobby') location.href = '/';
    };
  });
  socket.on('disconnect', () => toast('连接断开，正在重连…'));
  recentRooms.add(roomId);
  let wantLoad = new URLSearchParams(location.search).has('load');
  // 「和机器人练习」：自动坐下、补满机器人并开局
  let wantPractice = new URLSearchParams(location.search).has('practice');
  const ask = (event, data) => new Promise((res) => socket.emit(event, data, (r) => res(r || {})));
  async function startPractice() {
    const free = state.seats.findIndex((x) => !x);
    if (state.mySeat == null && free >= 0) await ask('sit', { seat: free });
    if (state.game.phase === 'waiting') {
      await ask('addBot', {});
      const r = await ask('start');
      if (!r.ok) toast(r.error || '开局失败');
    }
  }
  socket.on('state', (s) => {
    if (wantLoad) {
      wantLoad = false;
      history.replaceState(null, '', location.pathname);
      setTimeout(openLoadPanel, 0);
    }
    if (wantPractice) {
      wantPractice = false;
      history.replaceState(null, '', location.pathname);
      setTimeout(startPractice, 0);
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
    detectBomb(prev, s);
    reactToChanges(prev, s);
    render();
    keepAwake(['tribute', 'return', 'playing'].includes(s.game.phase) && !s.paused);
  });

  // —— 状态变化带来的音效、出牌动画、结算页 ——
  let animSeats = new Set(); // 本次渲染需要播放「飞入」动画的座位
  const trickSig = (st, seat) => {
    const t = st?.game?.trick?.[seat];
    if (!t) return '';
    return `${st.game.roundNo}:${t.type}:${t.type === 'play' ? t.cards.map((c) => c.id).join(',') : st.game.lastPlay?.seat}`;
  };
  function reactToChanges(prev, cur) {
    if (!prev) return;
    const g = cur.game;
    const pg = prev.game;
    for (let seat = 0; seat < 4; seat++) {
      const sig = trickSig(cur, seat);
      if (!sig || sig === trickSig(prev, seat)) continue;
      animSeats.add(seat);
      const t = g.trick[seat];
      if (t.type === 'pass') sfx.pass();
      else if (!(g.lastPlay && g.lastPlay.seat === seat && bombPower(g.lastPlay.combo))) sfx.play();
    }
    if (g.lastPlay && bombPower(g.lastPlay.combo) && playSig(prev) !== playSig(cur)) sfx.bomb();
    // 轮到自己
    const mine = cur.mySeat != null && (g.pending || []).includes(cur.mySeat) && !cur.paused;
    const wasMine = prev.mySeat != null && (pg.pending || []).includes(prev.mySeat) && !prev.paused;
    if (mine && (!wasMine || g.turn !== pg.turn || g.phase !== pg.phase)) sfx.turn();
    // 一局结束：弹出结算页
    const over = (ph) => ph === 'roundOver' || ph === 'matchOver';
    if (over(g.phase) && (!over(pg.phase) || g.roundNo !== pg.roundNo)) {
      showResult(cur);
      const myTeam = cur.mySeat == null ? null : cur.mySeat % 2;
      if (myTeam == null || g.lastResult.winTeam === myTeam) sfx.win(); else sfx.lose();
    }
    if (!over(g.phase)) hide('#resultModal');
  }

  // —— 结算页 ——
  function showResult(st) {
    const g = st.game;
    const r = g.lastResult;
    const myTeam = st.mySeat == null ? null : st.mySeat % 2;
    const win = myTeam == null || r.winTeam === myTeam;
    const title = $('#resTitle');
    title.className = `res-title ${win ? 'win' : 'lose'}`;
    title.textContent = g.phase === 'matchOver'
      ? `🎉 ${TEAM_NAMES[r.winTeam]}打过 A，赢得整场！`
      : myTeam == null ? `${TEAM_NAMES[r.winTeam]}胜利` : (win ? '胜利！' : '失败');
    $('#resLevel').innerHTML = `<span>${TEAM_NAMES[r.winTeam]} 升 ${r.up} 级</span>` +
      `<span class="lv">${rankLabel(r.from)}</span><span class="arrow">→</span><span class="lv to">${rankLabel(r.to)}</span>`;
    $('#resRank').innerHTML = r.finishOrder.slice(0, 4).map((seat, i) => {
      const s = st.seats[seat];
      return `<div class="r ${i === 0 ? 'first' : ''}"><span class="pos">${FINISH_NAMES[i]}</span>` +
        avatarHtml(s?.avatar, s?.name || '?', { bot: s?.bot, team: seat % 2 }) +
        `<span class="nm">${escapeHtml(s?.name || '空位')}</span><span class="team-badge t${seat % 2}">${TEAM_NAMES[seat % 2]}</span></div>`;
    }).join('');
    // 下一局谁给谁进贡（抗贡要等发完牌才知道）
    const fo = r.finishOrder;
    const nm = (seat) => `<b>${escapeHtml(st.seats[seat]?.name || '空位')}</b>`;
    let note = '';
    if (g.phase !== 'matchOver') {
      note = fo[0] % 2 === fo[1] % 2
        ? `双下！下一局 ${nm(fo[2])}、${nm(fo[3])} 双贡：大的给 ${nm(fo[0])}，小的给 ${nm(fo[1])}`
        : `下一局 ${nm(fo[3])} 向 ${nm(fo[0])} 进贡`;
      note += '<br>（进贡方共持两张大王可抗贡）';
    }
    if (r.aFail) note += `<br>${TEAM_NAMES[r.aFail.team]}打 A 失败（第 ${r.aFail.count} 次）${r.aFail.dropped ? '，退回打 2' : ''}`;
    $('#resNote').innerHTML = note;
    const btns = $('#resBtns');
    btns.innerHTML = '';
    const mk = (text, fn, cls = '') => {
      const b = document.createElement('button');
      b.textContent = text;
      b.className = cls;
      b.onclick = fn;
      btns.appendChild(b);
    };
    mk('查看牌局', () => hide('#resultModal'));
    if (st.mySeat != null) {
      mk(g.phase === 'matchOver' ? '再来一场' : '下一局', () => { hide('#resultModal'); emit('nextRound'); }, 'primary');
    }
    show('#resultModal');
  }

  // —— 设置 ——
  function openSettings() {
    document.querySelectorAll('#settingsPanel .seg').forEach((seg) => {
      const key = seg.dataset.set;
      seg.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('on', settings[key] === b.dataset.v);
        b.onclick = () => {
          settings[key] = b.dataset.v;
          saveSettings();
          applyTheme();
          openSettings();
          if (state) render();
          if (key === 'sound' && b.dataset.v === 'on') { sfx.unlock(); sfx.turn(); }
        };
      });
    });
    show('#settingsPanel');
  }
  $('#settingsPanel').addEventListener('click', (e) => {
    if (e.target.id === 'settingsPanel' || e.target.closest('.cancel')) hide('#settingsPanel');
  });

  // —— 炸弹特效：新出的牌是炸弹 / 同花顺 / 天王炸时弹出横幅并震动牌桌 ——
  const playSig = (st) => {
    const lp = st?.game?.lastPlay;
    const t = lp && st.game.trick?.[lp.seat];
    return t ? `${st.game.roundNo}:${lp.seat}:${t.cards.map((c) => c.id).join(',')}` : '';
  };
  function detectBomb(prev, cur) {
    const lp = cur.game.lastPlay;
    if (!prev || !lp || playSig(prev) === playSig(cur) || !bombPower(lp.combo)) return;
    const name = cur.seats[lp.seat]?.name || '';
    const title = lp.combo.type === TYPES.JOKER_BOMB ? '天王炸！'
      : lp.combo.type === TYPES.STRAIGHT_FLUSH ? '同花顺！' : `${lp.combo.len} 炸！`;
    const fx = $('#fx');
    fx.querySelector('.fx-title').textContent = title;
    fx.querySelector('.fx-sub').textContent = name;
    fx.className = `fx p${Math.min(4, Math.floor(bombPower(lp.combo) / 2))}`;
    void fx.offsetWidth; // 重新触发动画
    fx.classList.add('show');
    document.querySelector('.table').classList.remove('shake');
    void document.querySelector('.table').offsetWidth;
    document.querySelector('.table').classList.add('shake');
    clearTimeout(detectBomb.t);
    detectBomb.t = setTimeout(() => fx.classList.add('hidden'), 1600);
  }

  // —— 打牌时保持屏幕常亮（浏览器支持时） ——
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch { /* 不支持或被拒绝时忽略 */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (state) keepAwake(['tribute', 'return', 'playing'].includes(state.game.phase) && !state.paused);
  });

  // —— 记牌器 ——
  let counterOn = store.get('gd_counter') !== '0';
  $('#counterBtn').onclick = () => {
    counterOn = !counterOn;
    store.set('gd_counter', counterOn ? '1' : '0');
    renderCounter();
  };
  function renderCounter() {
    const g = state.game;
    const el = $('#counter');
    const show = counterOn && g.playedCounts && g.phase !== 'waiting';
    el.classList.toggle('hidden', !show);
    $('#counterBtn').classList.toggle('on', counterOn);
    if (!show) return;
    // 玩家：外面还剩几张（总数 - 已出 - 自己手里）；观战：还没出的张数
    const mine = {};
    for (const c of g.myHand || []) mine[c.rank] = (mine[c.rank] || 0) + 1;
    const order = [17, 16, g.level, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]
      .filter((r, i, a) => a.indexOf(r) === i);
    const label = { 17: '大', 16: '小' };
    el.innerHTML = `<span class="ct-title">${state.mySeat == null ? '未出' : '外面'}</span>` + order.map((r) => {
      const total = r >= 16 ? 2 : 8;
      const left = total - (g.playedCounts[r] || 0) - (mine[r] || 0);
      const cls = [r >= 16 ? 'joker' : '', r === g.level ? 'level' : '', left === 0 ? 'zero' : ''].join(' ');
      const tip = r === 17 ? '大王' : r === 16 ? '小王' : r === g.level ? '级牌' : '';
      return `<span class="ct ${cls}" title="${tip}"><i>${label[r] || rankLabel(r)}</i><b>${left}</b></span>`;
    }).join('');
  }

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
  const chatBubbles = {}; // seat -> { text, until }
  socket.on('chat', (m) => {
    addChat(m);
    if (m.seat != null) {
      chatBubbles[m.seat] = { text: m.text, until: Date.now() + 3000 };
      render();
      setTimeout(() => { if (state) render(); }, 3050);
    }
    if ($('#chatPanel').classList.contains('hidden')) {
      unread += 1;
      $('#chatBadge').textContent = unread > 99 ? '99+' : String(unread);
      show('#chatBadge');
    }
  });
  $('#chatBtn').onclick = () => {
    $('#chatPanel').classList.toggle('hidden');
    unread = 0;
    hide('#chatBadge');
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

  const saveGame = () => socket.emit('save', null, (r) => {
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
  function rename() {
    const n = prompt('新昵称', myName);
    if (n && n.trim()) {
      myName = n.trim().slice(0, 12);
      store.set('gd_name', myName);
      socket.emit('join', { roomId, playerId, name: myName, god: !!godMode });
    }
  }

  // —— 出牌操作 ——
  let confirmArmed = null; // 已提示确认的选牌（排序后的 id 串）
  const selSig = () => [...selected].sort().join(',');
  $('#playBtn').onclick = () => {
    const g = state.game;
    if (!selected.size) return toast('请先选牌');
    // 设置里开了「出牌二次确认」：第一次点只提示，2.5 秒内对同一组牌再点才出
    if (settings.confirm === 'on' && confirmArmed !== selSig()) {
      confirmArmed = selSig();
      $('#playBtn .lbl').textContent = '确认出牌？';
      setTimeout(() => { confirmArmed = null; if (state) updateControls(); }, 2500);
      return;
    }
    confirmArmed = null;
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
  // 一键理牌：在「按组合（手数最少）」和「按点数」之间切换
  $('#arrangeBtn').onclick = () => {
    arrangeMode = arrangeMode === 'combo' ? 'rank' : 'combo';
    store.set('gd_arrange', arrangeMode);
    groups = [];
    selected.clear();
    renderHand(true);
  };
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
  const actionsEl = document.querySelector('.actions'); // 渲染时挂到自己座位上方
  let drag = null;
  const applyDrag = (id) => {
    if (drag.on) selected.add(id); else selected.delete(id);
    optionIndex = 0;
    updateSelection();
  };
  handEl.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.card');
    if (!el || state.mySeat == null) return; // 观战时手牌只读
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
  window.addEventListener('resize', () => { if (state) render(); });
  $('#autoBtn').onclick = () => emit('auto', { on: !state.game.auto[state.mySeat] });
  $('#cancelAutoBtn').onclick = () => emit('auto', { on: false });

  // —— 渲染 ——
  function cardEl(card, level, big = false) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = card.id;
    if (card.suit === 'J') {
      el.classList.add('joker', card.rank === 17 ? 'big' : 'small');
      el.innerHTML = big
        ? `<div class="lbl">${card.rank === 17 ? '大王' : '小王'}</div><div class="jk">JOKER</div><div class="big-suit">★</div>`
        : (card.rank === 17 ? '<span>大</span><span>王</span>' : '<span>小</span><span>王</span>');
    } else {
      if (card.suit === 'H' || card.suit === 'D') el.classList.add('red');
      if (card.rank === level) el.classList.add('level');
      if (isWild(card, level)) { el.classList.add('wild'); el.title = '逢人配'; }
      const suit = SUIT_SYMBOLS[card.suit];
      const FACE = { 11: '♝', 12: '♛', 13: '♚' };
      const center = FACE[card.rank] ? `<div class="face">${FACE[card.rank]}</div>` : `<div class="big-suit">${suit}</div>`;
      el.innerHTML = big
        ? `<div class="lbl">${rankLabel(card.rank)}<span>${suit}</span></div>${center}` +
          `<div class="corner">${rankLabel(card.rank)}${suit}</div>`
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
    const viewer = mySeat ?? viewSeat;
    const paused = state.paused;
    const inGame = ['tribute', 'return', 'playing'].includes(g.phase) && !paused;
    const pending = g.pending || [];
    const seatsOpen = g.phase === 'waiting' || paused;

    // 顶栏与比分牌
    $('#roleChip').classList.toggle('hidden', mySeat != null);
    $('#godFab').classList.toggle('hidden', mySeat != null || g.phase === 'waiting');
    // 入座后上帝视角自动失效（服务器也不再发送手牌）
    if (godMode && mySeat != null) { godMode = null; hide('#godPanel'); }
    for (const t of [0, 1]) {
      $(`#lv${t}`).textContent = rankLabel(g.teamLevels[t]);
      $(`#af${t}`).textContent = g.aFails?.[t] ? `打A失败×${g.aFails[t]}` : '';
    }
    $('#roundNo').textContent = g.roundNo ? `第 ${g.roundNo} 局` : '未开始';
    $('#lvCur').textContent = rankLabel(g.level);

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
      const tags = [`<span class="team-badge t${seat % 2}">${TEAM_NAMES[seat % 2]}</span>`];
      if (s && !s.online) tags.push('<span class="tag offline">离线</span>');
      if (s?.bot) tags.push('<span class="tag bot">机器人</span>');
      else if (inGame && g.auto[seat]) tags.push('<span class="tag auto">托管</span>');
      if (g.handCounts) {
        const n = g.handCounts[seat];
        const backs = '<i></i>'.repeat(Math.min(3, Math.max(1, Math.ceil(n / 9))));
        tags.push(`<span class="backs" title="剩 ${n} 张"><span class="stack">${n ? backs : ''}</span><b>${n}</b></span>`);
      }
      if (finishIdx >= 0 && (g.phase === 'playing' || finishIdx < 3)) tags.push(`<span class="tag rank">${FINISH_NAMES[finishIdx]}</span>`);
      plate.innerHTML =
        `<div class="av-wrap">${avatarHtml(s?.avatar, s?.name || '空', { bot: s?.bot, team: seat % 2 })}` +
        (inGame && pending.includes(seat)
          ? '<svg class="ring" viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="46"/>' +
            '<circle class="prog" cx="50" cy="50" r="46" pathLength="100"/></svg><span class="timer"></span>'
          : '') + '</div>' +
        `<div class="plate-text"><div class="name">${s ? nameHtml(seat) : '空位'}${seat === mySeat ? '（我）' : ''}</div>` +
        `<div class="meta">${tags.join('')}</div></div>`;
      const bub = chatBubbles[seat];
      if (bub && bub.until > Date.now()) {
        plate.insertAdjacentHTML('beforeend', `<div class="bubble chat">${escapeHtml(bub.text)}</div>`);
      }
      if (mySeat == null && seat !== viewSeat) {
        plate.classList.add('clickable');
        plate.title = '切换到这一家的视角';
        plate.onclick = (e) => { if (!e.target.closest('button')) setView(seat); };
      }
      if (seatsOpen) {
        const btns = document.createElement('div');
        btns.className = 'seat-btns';
        plate.appendChild(btns);
        const seatBtn = (text, fn, cls = 'small') => {
          const b = document.createElement('button');
          b.className = cls;
          b.textContent = text;
          b.onclick = fn;
          btns.appendChild(b);
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
        trick.innerHTML = '<div class="bubble pass">不要</div>';
      }
      if (animSeats.has(seat)) trick.classList.add(`fly-${pos}`);
      if (pos === 0) box.prepend(trick); else box.appendChild(trick);
      if (pos === 0 && mySeat != null) {
        // 手机横屏高度不够：按钮和自己的头像排在同一行（轮到自己时替换掉自己上一手的牌）；
        // 其他情况浮在自己座位上方
        const inline = window.innerWidth > window.innerHeight && window.innerHeight < 520;
        actionsEl.classList.toggle('inline', inline);
        if (inline) box.prepend(actionsEl); else box.appendChild(actionsEl);
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
    // 进贡信息只在进贡/还贡阶段显示，这一局打出第一手牌后自动消失
    const firstPlayDone = Object.keys(g.playedCounts || {}).length > 0;
    if (g.tribute && inGame && (g.phase !== 'playing' || !firstPlayDone)) {
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

    animSeats = new Set();
    renderHand();
    renderCounter();
    if (godMode) renderGod();
    updateTimers();
  }

  // —— 上帝视角面板 ——
  function renderGod() {
    const { seats, game: g } = state;
    const hands = g.allHands;
    const playing = ['tribute', 'return', 'playing'].includes(g.phase);
    $('#gpMode').textContent = godMode === 'all' ? '所有玩家' : '查看玩家';
    $('#gpAll').classList.toggle('hidden', godMode !== 'all');
    $('#gpOne').classList.toggle('hidden', godMode !== 'one');
    const who = (seat, cls = '') => {
      const s = seats[seat];
      return avatarHtml(s?.avatar, s?.name || '空', { bot: s?.bot, team: seat % 2, cls });
    };
    const handOf = (seat) => (hands ? hands[seat] : g.revealed?.[seat]) || [];
    const leftText = (seat) => {
      const fi = g.finishOrder ? g.finishOrder.indexOf(seat) : -1;
      return fi >= 0 && fi < 3 ? `<span class="done">${FINISH_NAMES[fi]}</span>` : `剩 ${g.handCounts?.[seat] ?? 0} 张`;
    };

    if (godMode === 'all') {
      const viewer = viewSeat;
      for (let seat = 0; seat < 4; seat++) {
        const box = document.querySelector(`#gpAll .gp-box[data-pos="${(seat - viewer + 4) % 4}"]`);
        box.classList.toggle('turn', playing && (g.pending || []).includes(seat));
        box.innerHTML =
          `<div class="gp-who">${who(seat)}<b>${nameHtml(seat)}</b><span class="team-badge t${seat % 2}">${TEAM_NAMES[seat % 2]}</span></div>`;
        box.appendChild(cardsEl(handOf(seat), g.level, 'mini'));
        box.insertAdjacentHTML('beforeend', `<div class="left-n">${leftText(seat)}</div>`);
        box.onclick = () => setGod('one', seat);
      }
      const lp = g.lastPlay;
      $('#gpMidType').textContent = lp ? TYPE_NAMES[lp.combo.type] : (playing ? '首出' : '—');
      $('#gpMidSub').textContent = lp ? `${seatName(lp.seat)} 出牌` : (playing ? `轮到 ${seatName(g.turn ?? 0)}` : '当前出牌');
      return;
    }

    // 单人视角
    const seat = godSeat;
    const s = seats[seat];
    $('#gpCardHead').innerHTML = who(seat) +
      `<div class="info"><b>${nameHtml(seat)}</b><div class="row"><span class="team-badge t${seat % 2}">${TEAM_NAMES[seat % 2]}</span>` +
      `<span>${leftText(seat)}</span>${s?.bot ? '<span class="tag bot">机器人</span>' : ''}</div></div>`;
    const hand = handOf(seat);
    const gpHand = $('#gpHand');
    gpHand.innerHTML = '';
    const cols = arrangeHand(hand, g.level);
    for (const col of cols) {
      const colEl = document.createElement('div');
      colEl.className = `col ${col.kind}`;
      for (const c of col.cards) colEl.appendChild(cardEl(c, g.level, true));
      gpHand.appendChild(colEl);
    }
    if (!hand.length) gpHand.innerHTML = '<p class="muted">没有手牌</p>';
    sizeCols(gpHand, cols, window.innerHeight * 0.38, 60);
    $('#gpDots').innerHTML = [0, 1, 2, 3].map((i) => `<span class="${i === seat ? 'on' : ''}"></span>`).join('');
    const pick = $('#gpPick');
    pick.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('button');
      b.className = i === seat ? 'on' : '';
      b.innerHTML = `${who(i)}<span class="nm">${nameHtml(i)}</span><span class="team-badge t${i % 2}">${TEAM_NAMES[i % 2]}</span>`;
      b.onclick = () => { godSeat = i; renderGod(); };
      pick.appendChild(b);
    }
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

    const cols = arrangeHand(hand, g.level, groups, arrangeMode);
    $('#arrangeBtn').textContent = arrangeMode === 'combo' ? '按点数排' : '一键理牌';
    $('#arrangeBtn').title = arrangeMode === 'combo' ? '恢复按点数排列' : '自动拆成顺子、钢板、三带二等组合，出牌手数最少';
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
    const landscape = window.innerWidth > window.innerHeight;
    handEl.classList.toggle('combo', arrangeMode === 'combo');
    const phone = window.innerWidth <= 600 && !landscape;
    const scale = { s: 0.82, m: 1, l: 1.18 }[settings.cardSize] || 1;
    // 操作按钮不再占一行，手牌可以更高
    // 竖屏时列多、宽度紧：牌宽至少 38px，列与列适当重叠（每列仍露出点数和花色）
    sizeCols(handEl, cols, window.innerHeight * (landscape && window.innerHeight < 520 ? 0.44 : phone ? 0.34 : 0.4), 84, scale, phone ? 38 : 30);
    updateSelection();
  }

  /** 按可用宽高计算列式手牌的牌宽：尽量大，放不下时列与列重叠 */
  function sizeCols(el, cols, maxH, maxW = 78, scale = 1, minW = 30) {
    const n = cols.length || 1;
    const tallest = Math.max(1, ...cols.map((c) => c.cards.length));
    const avail = el.clientWidth;
    const STRIP = 0.52; // 叠放时每张露出的高度（相对牌宽）
    const gap = el.classList.contains('combo') ? 7 : 3;
    // scale 来自设置里的牌面大小：放大时允许列与列重叠得更多
    let w = Math.max(minW, Math.min(maxW, maxH / (1.4 + (tallest - 1) * STRIP), (avail - gap * (n - 1)) / n)) * scale;
    const overlap = Math.max(0, (n * w + gap * (n - 1) - avail) / Math.max(1, n - 1));
    el.style.setProperty('--hw', `${Math.floor(w)}px`);
    el.classList.toggle('narrow', w < 40); // 牌太窄时隐藏右下角标，避免和中间花色挤在一起
    el.style.setProperty('--ov', `${Math.ceil(overlap)}px`);
  }

  function updateSelection() {
    handEl.querySelectorAll('.card').forEach((el) => el.classList.toggle('selected', selected.has(el.dataset.id)));
    updateControls();
  }

  function updateControls() {
    const g = state.game;
    const hand = g.myHand;
    if (!hand || state.mySeat == null) return;
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
      $('#playBtn .lbl').textContent = g.phase === 'tribute' ? '进贡' : '还贡';
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
      $('#playBtn .lbl').textContent = cards.length && !opts.length ? (g.lastPlay ? '管不上' : '牌型不对')
        : confirmArmed && confirmArmed === selSig() ? '确认出牌？' : '出牌';
    }

    $('#playBtn').disabled = !canPlay;
    $('#passBtn').classList.toggle('hidden', tributeMode);
    $('#hintBtn').classList.toggle('hidden', tributeMode);
    $('#passBtn').disabled = !myAction || !g.lastPlay;
    $('#hintBtn').disabled = !myAction;
    $('#sfBtn').classList.toggle('hidden', tributeMode);
    $('#groupBtn').disabled = !selected.size;
    const auto = !!g.auto[me] && ['tribute', 'return', 'playing'].includes(g.phase) && !state.paused;
    $('#autoBtn .lbl').textContent = auto ? '取消托管' : '托管';
    $('#autoBtn').classList.toggle('on', auto);
    // 操作按钮只在轮到自己时浮现；托管中显示「取消托管」
    actionsEl.classList.toggle('show', myAction && !auto);
    actionsEl.classList.toggle('auto', auto);
  }

  /** 头像外圈倒计时：圆环随剩余时间缩短，最后 5 秒变红闪烁 */
  function updateTimers() {
    if (!state || !state.deadline) return;
    const ms = Math.max(0, state.deadline - (Date.now() + clockOffset));
    const left = Math.ceil(ms / 1000);
    const frac = Math.min(1, ms / (state.turnMs || 30000));
    const mine = state.mySeat != null && (state.game.pending || []).includes(state.mySeat) && !state.paused;
    if (mine && left <= 5 && left > 0 && left !== updateTimers.last) sfx.tick();
    updateTimers.last = left;
    document.querySelectorAll('.av-wrap').forEach((wrap) => {
      const prog = wrap.querySelector('.prog');
      if (!prog) return;
      prog.style.strokeDashoffset = String(100 - frac * 100);
      wrap.classList.toggle('urgent', left <= 5);
      wrap.querySelector('.timer').textContent = left;
    });
  }
  setInterval(updateTimers, 200);
}
