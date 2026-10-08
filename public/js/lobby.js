// 大厅
import { $, store, profile, escapeHtml, recentRooms } from './util.js';
import { avatarHtml, pickAvatar } from './avatar.js';
import { openStatsPanel } from './stats.js';

export function initLobby() {
  $('#lobby').classList.remove('hidden');
  $('#nameInput').value = profile.name;
  const showAvatar = () => {
    $('#lobbyAvatar').innerHTML = avatarHtml(store.get('gd_avatar'), $('#nameInput').value || profile.name, { cls: 'big' });
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
  $('#lobbyStatsBtn').onclick = openStatsPanel;
  $('#lobbyLoadBtn').onclick = () => go(newCode(), '?load=1');
  $('#joinBtn').onclick = () => {
    const code = $('#codeInput').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code) go(code);
  };
}
