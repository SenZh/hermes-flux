/**
 * 附件删除键的几何取证：圆盘是否居中、热区是否盖住缩略图。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createDriveSession } from './control-flux.mjs';

const OUT = path.resolve('artifacts/verification/input-dock-redesign');
fs.mkdirSync(OUT, { recursive: true });

const session = await createDriveSession({ entry: '/packages/desktop/dist/renderer/index.html' });

try {
  await session.evaluate(`(() => {
    const s = window.__fluxState;
    s.gatewayConnected = true;
    s.gatewayConnecting = false;
    s.isStreaming = false;
    s.theme = 'ayu-light';
    s.attachments = [
      { id: 'a1', name: 'shot.png', type: 'image', previewUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAA8CAIAAAC1nk4lAAAAUklEQVR4nO3OAQkAIBAAMcNbxComM4b3MFiArXv2OOv7QDpMWlo6QFpaOkBaWjpAWlo6QFpaOkBaWjpAWlo6QFpaOkBaWjpAWlo6QFpaOmBk+gGbesH3N5ThNQAAAABJRU5ErkJggg==' },
      { id: 'a2', name: 'brief.pdf', type: 'pdf' },
    ];
    s.queuedMessages = [];
    window.__fluxRender();
    return true;
  })()`);
  await session.waitFor('document.querySelector(".composer-attach__remove") !== null', 8000, 'remove button');

  const geo = await session.evaluate(`(() => {
    const btn = document.querySelector('.composer-attach-thumb .composer-attach__remove');
    const thumb = document.querySelector('.composer-attach-thumb');
    const svg = btn.querySelector('svg');
    const br = btn.getBoundingClientRect();
    const tr = thumb.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    const before = getComputedStyle(btn, '::before');
    const fileBtn = document.querySelector('.composer-attach-file .composer-attach__remove');
    const fr = fileBtn.getBoundingClientRect();
    return {
      thumb: { w: Math.round(tr.width), h: Math.round(tr.height) },
      hit: { w: Math.round(br.width), h: Math.round(br.height) },
      hitCoverageOfThumbPct: Math.round((br.width * br.height) / (tr.width * tr.height) * 100),
      svgCenter: { x: Math.round(sr.x + sr.width / 2), y: Math.round(sr.y + sr.height / 2) },
      hitCenter: { x: Math.round(br.x + br.width / 2), y: Math.round(br.y + br.height / 2) },
      discSize: before.width + 'x' + before.height,
      discInset: before.inset,
      discMargin: before.margin,
      fileHit: { w: Math.round(fr.width), h: Math.round(fr.height) },
      filePillHeight: Math.round(document.querySelector('.composer-attach-file').getBoundingClientRect().height),
    };
  })()`);
  console.log(JSON.stringify(geo, null, 2));

  const rect = await session.evaluate(`(() => {
    const el = document.querySelector('.composer-attach-rail');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  const shot = await session.sendCommand('Page.captureScreenshot', {
    format: 'png',
    clip: { x: rect.x - 8, y: rect.y - 8, width: rect.width + 16, height: rect.height + 16, scale: 3 },
  });
  fs.writeFileSync(path.join(OUT, 'zoom-light-attach.png'), Buffer.from(shot.data, 'base64'));
} finally {
  await session.cleanup();
}
