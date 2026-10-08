// 房间设置：每步时限、从几打起、机器人难度、房间密码（入座玩家可改）
import { rankLabel } from '/shared/rules.js';
import { $ } from './util.js';

export const SKILL_NAMES = { easy: '简单', normal: '普通', hard: '困难' };

export function settingsSummary(st) {
  const s = st?.settings;
  if (!s) return '';
  return `每步 ${s.turnSec} 秒 · 从 ${rankLabel(s.startLevel)} 打起 · 机器人${SKILL_NAMES[s.botSkill]}${s.hasPassword ? ' · 🔒 有密码' : ''}`;
}

/** o: { emit, getState } */
export function initRoomSettings(o) {
  const panel = $('#roomSetPanel');
  const sel = $('#rsLevel');
  for (let lv = 2; lv <= 14; lv++) sel.insertAdjacentHTML('beforeend', `<option value="${lv}">${rankLabel(lv)}</option>`);
  panel.addEventListener('click', (e) => {
    if (e.target === panel || e.target.closest('.cancel')) panel.classList.add('hidden');
  });
  panel.querySelectorAll('.seg[data-rs]').forEach((seg) => {
    seg.querySelectorAll('button').forEach((b) => {
      b.onclick = () => o.emit('settings', { [seg.dataset.rs]: seg.dataset.rs === 'turnSec' ? Number(b.dataset.v) : b.dataset.v });
    });
  });
  sel.onchange = () => o.emit('settings', { startLevel: Number(sel.value) });
  let pwdDirty = false;
  $('#rsPwdSave').onclick = () => {
    pwdDirty = false;
    o.emit('settings', { password: $('#rsPwd').value });
  };
  $('#rsPwd').oninput = () => { pwdDirty = true; };

  function refresh() {
    const st = o.getState();
    if (!st || panel.classList.contains('hidden')) return;
    const s = st.settings;
    const seated = st.mySeat != null;
    panel.querySelectorAll('.seg[data-rs]').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('on', String(s[seg.dataset.rs]) === b.dataset.v);
        b.disabled = !seated;
      });
    });
    sel.value = String(s.startLevel);
    sel.disabled = !seated || st.game.phase !== 'waiting';
    const pwd = $('#rsPwd');
    if (!pwdDirty) pwd.value = seated ? (s.password || '') : '';
    pwd.placeholder = seated ? '不设密码' : (s.hasPassword ? '已设密码' : '未设密码');
    pwd.disabled = !seated;
    $('#rsPwdSave').disabled = !seated;
    $('#rsNote').textContent = !seated ? '只有入座的玩家可以修改设置'
      : st.game.phase !== 'waiting' ? '对局已开始：起始级数不能再改，其他设置从下一步起生效' : '修改后会在聊天里通知所有人';
  }

  return {
    open() { pwdDirty = false; panel.classList.remove('hidden'); refresh(); },
    refresh() { if (!panel.classList.contains('hidden')) refresh(); },
  };
}
