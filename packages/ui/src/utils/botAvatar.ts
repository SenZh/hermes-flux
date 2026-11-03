/**
 * Bot / Agent 头像渲染（唯一实现）。
 *
 * 设计意图 (Why)：头像资产来自网关（Base64 Data URL / HTTP URL / 本地文件 URL），
 *   渲染规则必须只有一处，否则微轨、会话行、群聊拼图、任务弹窗会各自漂移出不同兜底。
 * 防范的历史坑 (Pitfall)：该函数一度寄生在 LeftRail 模板文件里，模板迁 React 后变成"模板文件只为导出它而活着"的僵尸。
 * 约束与规则 (Rules)：优先真实 <img>；仅在明确无资产时回退确定性几何图腾；色值只用 Token（两个品牌色有 gate-theme-allow）。
 */

// gate-theme-allow: 1:1 对齐官方 Xiaofawang 黄色三角形品牌头像，属品牌资产固定色而非皮肤面
const XIAOFAWANG_YELLOW = '#FACC15';
// gate-theme-allow: 1:1 对齐官方 Bot 双眼瞳孔自然黑，属品牌资产固定色而非皮肤面
const BOT_PUPIL_BLACK = '#18181B';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 1:1 消费网关真实自定义头像资产：
 * 1. 有 avatarUrl 优先渲染真实 <img>；
 * 2. 名称含 xiaofawang 或哈希落到 triangle 时渲染官方黄色三角形；
 * 3. 其余按名称哈希给出确定性几何图腾，保证同一 Bot 每次渲染一致。
 */
export function renderBotAvatar(name: string, displayName?: string, avatarUrl?: string, size = 36): string {
  if (avatarUrl) {
    return `<img src="${escapeHtml(avatarUrl)}" style="
      width: ${size}px;
      height: ${size}px;
      border-radius: 8px;
      object-fit: cover;
      flex-shrink: 0;
      border: 1px solid var(--border-subtle);
      display: block;
    " alt="${escapeHtml(displayName || name)}" />`;
  }

  const cleanName = (name || 'agent').toLowerCase().trim();

  let hash = 0;
  for (const ch of cleanName) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  const shapes = ['circle', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop'];
  const pickedShape = shapes[hash % shapes.length];

  if (cleanName.includes('xiaofawang') || pickedShape === 'triangle') {
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" style="flex-shrink: 0; display: block;">
        <path d="M18 4.5 C19.2 2.5 21.8 2.5 23 4.5 L34 26 C35.2 28.2 33.8 31 31.2 31 L6.8 31 C4.2 31 2.8 28.2 4 26 Z" fill="${XIAOFAWANG_YELLOW}" />
        <circle cx="15" cy="18" r="1.8" fill="${BOT_PUPIL_BLACK}" />
        <circle cx="23" cy="18" r="1.8" fill="${BOT_PUPIL_BLACK}" />
      </svg>
    `;
  }

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" style="flex-shrink: 0; display: block;">
      <rect width="36" height="36" rx="8" fill="var(--bg-panel)" />
      ${
        pickedShape === 'circle'
          ? `<circle cx="18" cy="18" r="13" fill="var(--accent)" />`
          : pickedShape === 'cloud'
          ? `<path d="M10 24 a6 6 0 0 1 -1 -12 a7.5 7.5 0 0 1 14 -1 a5.5 5.5 0 0 1 5 13 Z" fill="var(--accent)" />`
          : `<rect x="5" y="5" width="26" height="26" rx="6" fill="var(--accent)" />`
      }
      <circle cx="14" cy="17" r="1.8" fill="${BOT_PUPIL_BLACK}" />
      <circle cx="22" cy="17" r="1.8" fill="${BOT_PUPIL_BLACK}" />
    </svg>
  `;
}
