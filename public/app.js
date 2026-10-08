// 入口：按地址进入大厅或房间
import { applyTheme } from './js/settings.js';
import { sfx } from './js/sfx.js';
import { initLobby } from './js/lobby.js';
import { initRoom } from './js/room.js';

applyTheme();
document.addEventListener('pointerdown', () => sfx.unlock());

// 可安装为手机桌面应用（PWA）
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

const match = location.pathname.match(/^\/r\/([A-Za-z0-9]+)/);
if (!match) initLobby();
else initRoom(match[1].toUpperCase());
