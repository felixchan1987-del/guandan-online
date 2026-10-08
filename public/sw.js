// 掼蛋在线 Service Worker：只缓存静态页面资源，便于安装到桌面和弱网时快速打开。
// 对局数据（socket.io）、头像等动态内容一律直连服务器，不缓存。
const CACHE = 'guandan-v2';
const SHELL = ['/', '/style.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png',
  '/shared/rules.js', '/shared/hint.js', '/shared/arrange.js', '/shared/replay.js',
  '/js/util.js', '/js/avatar.js', '/js/settings.js', '/js/sfx.js', '/js/cards.js', '/js/layout.js', '/js/lobby.js',
  '/js/room.js', '/js/fourHands.js', '/js/replayView.js', '/js/logPanel.js', '/js/stats.js', '/js/emotes.js',
  '/js/roomSettings.js', '/rules.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/avatar/')) return;
  // 网络优先：总是拿最新版本，离线或失败时才用缓存（房间页 /r/xxx 用首页外壳）
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(url.pathname.startsWith('/r/') ? '/' : e.request, copy));
    }
    return res;
  }).catch(() => caches.match(url.pathname.startsWith('/r/') ? '/' : e.request)));
});
