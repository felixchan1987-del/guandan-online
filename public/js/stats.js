// 战绩：只记在本浏览器（局数、胜率、头游、双下、整场、常用牌型）
import { TYPE_NAMES } from '/shared/rules.js';
import { store } from './util.js';

const KEY = 'gd_stats';
const empty = () => ({
  rounds: 0, wins: 0, firsts: 0, doubleWins: 0, doubleLosses: 0, ups: 0, matches: 0, matchWins: 0, combos: {}, seen: [],
});

function load() {
  try { return { ...empty(), ...JSON.parse(store.get(KEY) || '{}') }; } catch { return empty(); }
}
const save = (s) => store.set(KEY, JSON.stringify(s));

/** 一局结束时记一笔（同一局刷新页面不会重复记） */
export function recordRound(st, roomId) {
  if (st.mySeat == null) return;
  const g = st.game;
  const r = g.lastResult;
  const s = load();
  const key = `${roomId}:${g.roundNo}:${r.finishOrder.join('')}:${g.teamLevels.join(',')}`;
  if (s.seen.includes(key)) return;
  s.seen = [key, ...s.seen].slice(0, 30);
  const myTeam = st.mySeat % 2;
  const win = r.winTeam === myTeam;
  const double = r.finishOrder[0] % 2 === r.finishOrder[1] % 2;
  s.rounds += 1;
  if (win) { s.wins += 1; s.ups += r.up; }
  if (r.finishOrder[0] === st.mySeat) s.firsts += 1;
  if (double && win) s.doubleWins += 1;
  if (double && !win) s.doubleLosses += 1;
  if (g.phase === 'matchOver') { s.matches += 1; if (win) s.matchWins += 1; }
  save(s);
}

/** 自己出的一手牌（按牌型计数） */
export function recordPlay(type) {
  const s = load();
  s.combos[type] = (s.combos[type] || 0) + 1;
  save(s);
}

export function resetStats() {
  save(empty());
}

export function renderStats(el) {
  const s = load();
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const tile = (label, value, sub = '') => `<div class="st-tile"><b>${value}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const combos = Object.entries(s.combos).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = combos[0]?.[1] || 1;
  el.innerHTML = `<div class="st-grid">${
    tile('局数', s.rounds) +
    tile('胜率', pct(s.wins, s.rounds), `${s.wins} 胜`) +
    tile('头游', s.firsts, pct(s.firsts, s.rounds)) +
    tile('双下对手', s.doubleWins) +
    tile('被双下', s.doubleLosses) +
    tile('累计升级', s.ups) +
    tile('整场', `${s.matchWins}/${s.matches}`, '胜/场')
  }</div>` + (combos.length
    ? `<div class="st-combos"><div class="st-h">最常出的牌型</div>${combos.map(([t, n]) =>
      `<div class="st-bar"><span>${TYPE_NAMES[t] || t}</span><i style="width:${Math.max(6, (n / max) * 100)}%"></i><b>${n}</b></div>`).join('')}</div>`
    : '<p class="muted">还没有记录，打完一局就有了。</p>');
}

/** 打开战绩面板（大厅和房间共用） */
export function openStatsPanel() {
  const panel = document.querySelector('#statsPanel');
  renderStats(document.querySelector('#statsBody'));
  panel.onclick = (e) => { if (e.target === panel || e.target.closest('.cancel')) panel.classList.add('hidden'); };
  document.querySelector('#statsReset').onclick = () => {
    if (confirm('清空本浏览器的战绩记录？')) { resetStats(); renderStats(document.querySelector('#statsBody')); }
  };
  panel.classList.remove('hidden');
}
