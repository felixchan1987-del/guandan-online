// 通用工具：DOM、本地存储、提示、玩家身份
import { rankLabel, SUIT_SYMBOLS } from '/shared/rules.js';

export const $ = (sel) => document.querySelector(sel);
export const FINISH_NAMES = ['头游', '二游', '三游', '末游'];
export const TEAM_NAMES = ['蓝队', '红队'];

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 忽略 */ } },
};

// 本浏览器的玩家身份：id 固定，昵称可改
let pid = store.get('gd_pid');
if (!pid) {
  pid = Math.random().toString(36).slice(2) + Date.now().toString(36);
  store.set('gd_pid', pid);
}
export const profile = {
  id: pid,
  name: store.get('gd_name') || `玩家${Math.floor(Math.random() * 900 + 100)}`,
};

export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.add('hidden'), 1800);
}

// 本浏览器保存的存档（最多 8 个）
export const localSaves = {
  list() { try { return JSON.parse(store.get('gd_saves') || '[]'); } catch { return []; } },
  add(entry) { store.set('gd_saves', JSON.stringify([entry, ...this.list()].slice(0, 8))); },
  remove(code) { store.set('gd_saves', JSON.stringify(this.list().filter((e) => e.code !== code))); },
};

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function cardText(card) {
  if (card.suit === 'J') return card.rank === 17 ? '大王' : '小王';
  return `${SUIT_SYMBOLS[card.suit]}${rankLabel(card.rank)}`;
}

// —— 最近去过的房间 ——
export const recentRooms = {
  list() { try { return JSON.parse(store.get('gd_recent') || '[]'); } catch { return []; } },
  add(code) {
    const list = this.list().filter((r) => r.code !== code);
    store.set('gd_recent', JSON.stringify([{ code, t: Date.now() }, ...list].slice(0, 5)));
  },
};
