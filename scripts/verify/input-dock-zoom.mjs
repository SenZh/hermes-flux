/**
 * 输入舱局部放大取证：按 CDP clip 只截输入舱区域，便于逐像素核对按钮与配色。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createDriveSession } from './control-flux.mjs';

const OUT = path.resolve('artifacts/verification/input-dock-redesign');
fs.mkdirSync(OUT, { recursive: true });

const session = await createDriveSession({ entry: '/packages/desktop/dist/renderer/index.html' });

const applyState = (patch) =>
  session.evaluate(`(() => {
    const s = window.__fluxState;
    Object.assign(s, ${JSON.stringify(patch)});
    window.__fluxRender();
    return true;
  })()`);

async function shot(name, padding = 24) {
  const rect = await session.evaluate(`(() => {
    const el = document.querySelector('.input-dock-container');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  const res = await session.sendCommand('Page.captureScreenshot', {
    format: 'png',
    clip: {
      x: Math.max(0, rect.x - padding),
      y: Math.max(0, rect.y - padding),
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
      scale: 2,
    },
  });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(res.data, 'base64'));
}

try {
  await applyState({
    gatewayConnected: true,
    gatewayConnecting: false,
    isStreaming: false,
    dockNotice: '',
    attachments: [],
    queuedMessages: [],
    modelMenuOpen: false,
    theme: 'obsidian-gold',
    availableModels: ['anthropic/claude-opus-4.8', 'openai/gpt-5.2'],
  });

  await session.evaluate(`(() => {
    const ta = document.getElementById('dock-prompt-input');
    ta.value = '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await shot('zoom-dark-empty.png');

  await session.evaluate(`(() => {
    const ta = document.getElementById('dock-prompt-input');
    ta.value = '把输入舱的发送图标换成播放头，停止改成红色方块。';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await shot('zoom-dark-filled.png');

  await applyState({ theme: 'ayu-light' });
  await shot('zoom-light-filled.png');

  await session.evaluate(`(() => {
    const ta = document.getElementById('dock-prompt-input');
    ta.value = '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await shot('zoom-light-empty.png');

  // 模型浮层局部
  await applyState({ modelMenuOpen: true, theme: 'obsidian-gold' });
  await session.evaluate(`(() => {
    const dd = document.getElementById('dock-approval-dropdown');
    if (dd) dd.style.display = 'none';
    return true;
  })()`);
  const menuRect = await session.evaluate(`(() => {
    const d = document.getElementById('dock-model-dropdown');
    const r = d.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  const menuShot = await session.sendCommand('Page.captureScreenshot', {
    format: 'png',
    clip: { x: menuRect.x - 12, y: menuRect.y - 12, width: menuRect.width + 24, height: menuRect.height + 24, scale: 2 },
  });
  fs.writeFileSync(path.join(OUT, 'zoom-dark-menu.png'), Buffer.from(menuShot.data, 'base64'));
  console.log('done');
} finally {
  await session.cleanup();
}
