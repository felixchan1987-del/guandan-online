import { store } from './util.js';

// —— 设置（保存在本浏览器） ——
const SETTINGS_DEFAULT = { cardSize: 'm', theme: 'blue', sound: 'on', confirm: 'off' };
export const settings = { ...SETTINGS_DEFAULT };
try { Object.assign(settings, JSON.parse(store.get('gd_settings') || '{}')); } catch { /* 忽略 */ }
export const saveSettings = () => store.set('gd_settings', JSON.stringify(settings));
export const applyTheme = () => { document.documentElement.dataset.theme = settings.theme; };
