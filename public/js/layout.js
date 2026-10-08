// 手牌尺寸计算：牌桌放完后剩余高度、列式手牌的牌宽
import { $ } from './util.js';

/** 牌桌放完所需内容后，留给手牌（不含工具栏等）的高度。手机浏览器地址栏占掉高度时也能正确适配 */
export function freeHandHeight() {
  const H = window.innerHeight;
  const shortLand = window.innerWidth > H && H < 520;
  const h = (sel) => { const e = document.querySelector(sel); return e && e.offsetParent !== null ? e.offsetHeight : 0; };
  const fixed = h('.topbar') + (shortLand ? 0 : h('.scoreboard') + 4) + (h('#counter') ? h('#counter') + 4 : 0);
  // 座位内容的自然高度（座位本身可能被网格拉伸，不能直接量）
  const natural = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return 0;
    const kids = [...e.children].filter((k) => k.offsetParent !== null && getComputedStyle(k).position !== 'absolute');
    if (getComputedStyle(e).flexDirection.startsWith('row')) return Math.max(0, ...kids.map((k) => k.offsetHeight));
    return kids.reduce((n, k) => n + k.offsetHeight, 0) + 2 * Math.max(0, kids.length - 1);
  };
  // 左右两家竖跨上面两行的布局（手机横屏、中等高度的电脑屏），那两行至少要有它们那么高
  const table = document.querySelector('.table');
  const sidesSpan = !!table && getComputedStyle(table).gridTemplateAreas.includes('"left top right"');
  const rows = sidesSpan
    ? Math.max(natural('.seat.top') + Math.max(natural('.center'), 40), natural('.seat.left'), natural('.seat.right')) + natural('.seat.bottom')
    : natural('.seat.top') + Math.max(natural('.seat.left'), natural('.seat.right'), natural('.center')) + natural('.seat.bottom');
  const tableH = rows + 16; // 牌桌上下内边距和行间距
  const area = $('#handArea');
  const extras = 10 + 10 // #hand 上内边距 + 区域上下内边距
    + (shortLand ? 0 : h('#handArea .tools') + 4)
    + (area.classList.contains('readonly') && !shortLand ? h('#handArea .god-bar') + 4 : 0);
  return H - fixed - tableH - extras;
}

/** 按可用宽高计算列式手牌的牌宽：尽量大，放不下时列与列重叠；hardMaxH 是绝对不能超过的高度 */
export function sizeCols(el, cols, maxH, maxW = 78, scale = 1, minW = 30, hardMaxH = Infinity) {
  const n = cols.length || 1;
  const tallest = Math.max(1, ...cols.map((c) => c.cards.length));
  const avail = el.clientWidth;
  const STRIP = 0.52; // 叠放时每张露出的高度（相对牌宽）
  const gap = el.classList.contains('combo') ? 4 : 0;
  const STEP = 0.72; // 宽度不够时列与列可以叠起来，每列至少露出 72% 宽度
  // scale 来自设置里的牌面大小：放大时允许列与列重叠得更多
  const byWidth = (avail - gap * (n - 1)) / (1 + (n - 1) * STEP);
  let w = Math.max(minW, Math.min(maxW, maxH / (1.4 + (tallest - 1) * STRIP), byWidth)) * scale;
  // 高度不够时宁可牌小一点，也不能把牌桌上的头像挤掉
  w = Math.max(22, Math.min(w, hardMaxH / (1.4 + (tallest - 1) * STRIP)));
  const overlap = Math.max(0, (n * w + gap * (n - 1) - avail) / Math.max(1, n - 1));
  el.style.setProperty('--hw', `${Math.floor(w)}px`);
  el.classList.toggle('narrow', w < 40); // 牌太窄时隐藏右下角标，避免和中间花色挤在一起
  el.classList.toggle('tight', overlap > 0); // 列有重叠时收紧标签
  el.style.setProperty('--ov', `${Math.ceil(overlap)}px`);
}
