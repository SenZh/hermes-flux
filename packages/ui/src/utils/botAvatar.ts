/**
 * Bot / Agent 头像渲染（唯一实现）。
 *
 * 设计意图 (Why)：头像资产来自网关（Base64 Data URL / HTTP URL / 本地文件 URL），
 *   渲染规则必须只有一处，否则微轨、会话行、群聊拼图、任务弹窗会各自漂移出不同兜底。
 * 防范的历史坑 (Pitfall)：该函数一度寄生在 LeftRail 模板文件里，模板迁 React 后变成"模板文件只为导出它而活着"的僵尸。
 * 约束与规则 (Rules)：优先真实 <img>；仅在明确无资产时回退确定性几何图腾；色值只用 Token（两个品牌色有 gate-theme-allow）。
 */

// gate-theme-allow: 适配全皮肤主题色彩，消除与暗黑界面的冲突
import { escapeHtml } from './html.js';
const XIAOFAWANG_YELLOW = 'var(--foreground)';
// gate-theme-allow: 1:1 对齐官方 Bot 双眼瞳孔自然黑，属品牌资产固定色而非皮肤面
const BOT_PUPIL_BLACK = '#18181B';

export { escapeHtml };

/**
 * 群聊拼图头像：2 人左右分栏、3-4 人 2x2 网格。
 *
 * 设计意图 (Why)：群聊没有单一身份，多人头像拼贴是它唯一可辨识的视觉签名；
 *   成员头像优先取真实资产，缺失时回退确定性图腾字母块。
 * 防范的历史坑 (Pitfall)：该函数曾寄生在左轨模板文件里，模板迁 React 时被连带删除，
 *   群聊行静默退化成纯文字（本次双审 P0）。现在它是独立导出，任何渲染路径都可复用。
 * 约束与规则 (Rules)：最多展示 4 个成员；0 成员时给固定占位，不得渲染空容器。
 */
export function renderGroupCollageAvatar(
  members: string[],
  profiles?: Array<{ name: string; avatar?: string; displayName?: string }>,
  size = 28,
): string {
  const profMap = new Map<string, string>();
  if (profiles) {
    for (const p of profiles) {
      if (p.avatar) {
        profMap.set(p.name.toLowerCase(), p.avatar);
        if (p.displayName) profMap.set(p.displayName.toLowerCase(), p.avatar);
      }
    }
  }

  const cleanMembers = (members || []).slice(0, 4);
  const count = cleanMembers.length;

  if (count === 0) {
    return `<span style="width: ${size}px; height: ${size}px; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border-subtle); display: inline-flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; color: var(--accent);">👥</span>`;
  }

  const cellHtmls = cleanMembers.map((member) => {
    const lower = member.toLowerCase().trim();
    const avatar = profMap.get(lower);
    if (avatar) {
      return `<img src="${escapeHtml(avatar)}" style="width: 100%; height: 100%; object-fit: cover; display: block;" alt="${escapeHtml(member)}" />`;
    }
    let hash = 0;
    for (const ch of lower) {
      hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    }
    const shapes = ['circle', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop'];
    const pickedShape = shapes[hash % shapes.length];

    if (lower.includes('xiaofawang') || pickedShape === 'triangle') {
      return `
        <svg viewBox="0 0 36 36" style="width: 100%; height: 100%; display: block;" fill="none">
          <path d="M18 4.5 C19.2 2.5 21.8 2.5 23 4.5 L34 26 C35.2 28.2 33.8 31 31.2 31 L6.8 31 C4.2 31 2.8 28.2 4 26 Z" fill="${XIAOFAWANG_YELLOW}" />
          <circle cx="15" cy="18" r="2.2" fill="${BOT_PUPIL_BLACK}" />
          <circle cx="23" cy="18" r="2.2" fill="${BOT_PUPIL_BLACK}" />
        </svg>
      `;
    }
    return `<span style="width: 100%; height: 100%; background: var(--primary-subtle); color: var(--primary); font-size: 8px; font-weight: 700; display: flex; align-items: center; justify-content: center; font-family: var(--font-mono);">${escapeHtml(lower.slice(0, 1).toUpperCase())}</span>`;
  });

  if (count === 2) {
    const subSize = Math.round(size * 0.68);
    return `
      <div style="width: ${size}px; height: ${size}px; position: relative; flex-shrink: 0; box-sizing: border-box;">
        <div style="position: absolute; top: 0; left: 0; width: ${subSize}px; height: ${subSize}px; border-radius: 6px; overflow: hidden; border: 1.5px solid var(--sidebar); z-index: 1; box-sizing: border-box; background: var(--panel);">
          ${cellHtmls[0]}
        </div>
        <div style="position: absolute; bottom: 0; right: 0; width: ${subSize}px; height: ${subSize}px; border-radius: 6px; overflow: hidden; border: 1.5px solid var(--sidebar); z-index: 2; box-sizing: border-box; background: var(--panel); box-shadow: -1px -1px 3px rgba(0, 0, 0, 0.45);">
          ${cellHtmls[1]}
        </div>
      </div>
    `;
  }

  return `
    <div style="width: ${size}px; height: ${size}px; border-radius: 6px; background: var(--panel); border: 1px solid var(--border-subtle); display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 1px; padding: 1.5px; overflow: hidden; box-sizing: border-box; flex-shrink: 0;">
      ${cellHtmls.map((cell) => `<div style="width: 100%; height: 100%; overflow: hidden; border-radius: 2px;">${cell}</div>`).join('')}
    </div>
  `;
}

/**
 * 1:1 消费网关真实自定义头像资产：
 * 1. 有 avatarUrl 优先渲染真实 <img>；
 * 2. 名称含 xiaofawang 或哈希落到 triangle 时渲染官方黄色三角形；
 * 3. 其余按名称哈希给出确定性几何图腾，保证同一 Bot 每次渲染一致。
 */
/**
 * 无头像时的确定性几何图腾。
 * 【设计意图】同一 Bot 每次渲染必须一致，不同 Bot 必须可区分。
 * 【防范的历史坑】早期只用 7 种形状，但 7 种里 5 种都落到同一个 rect 兜底分支，
 *   实测 3 个 Bot 全部渲染成同一块橙色方块，微轨完全无法辨认（真实截图取证）。
 * 【约束与规则】形状 × 色调二维组合，色调只取皮肤语义槽，禁止硬编码色值。
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

  if (cleanName.includes('xiaofawang')) {
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" style="flex-shrink: 0; display: block;">
        <path d="M18 4.5 C19.2 2.5 21.8 2.5 23 4.5 L34 26 C35.2 28.2 33.8 31 31.2 31 L6.8 31 C4.2 31 2.8 28.2 4 26 Z" fill="${XIAOFAWANG_YELLOW}" />
        <circle cx="15" cy="18" r="1.8" fill="${BOT_PUPIL_BLACK}" />
        <circle cx="23" cy="18" r="1.8" fill="${BOT_PUPIL_BLACK}" />
      </svg>
    `;
  }

  // 4 种形状 × 3 种色调 = 12 种可辨识组合，足以区分常见 Bot 数量
  const shapes = ['circle', 'squircle', 'hexagon', 'pill'] as const;
  const tones = ['--primary', '--success', '--warning'] as const;
  const pickedShape = shapes[hash % shapes.length];
  const pickedTone = tones[Math.floor(hash / shapes.length) % tones.length];

  const body = pickedShape === 'circle'
    ? `<circle cx="18" cy="18" r="13" fill="var(${pickedTone})" />`
    : pickedShape === 'hexagon'
      ? `<path d="M18 5 L30 12 L30 25 L18 32 L6 25 L6 12 Z" fill="var(${pickedTone})" />`
      : pickedShape === 'pill'
        ? `<rect x="6" y="9" width="24" height="18" rx="9" fill="var(${pickedTone})" />`
        : `<rect x="5" y="5" width="26" height="26" rx="7" fill="var(${pickedTone})" />`;

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" style="flex-shrink: 0; display: block;">
      <rect width="36" height="36" rx="8" fill="var(--panel)" />
      ${body}
      <circle cx="14" cy="17" r="1.8" fill="${BOT_PUPIL_BLACK}" />
      <circle cx="22" cy="17" r="1.8" fill="${BOT_PUPIL_BLACK}" />
    </svg>
  `;
}
