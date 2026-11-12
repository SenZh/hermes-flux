/**
 * 运行态取证：确认「无草稿只有停止」在真实宿主里成立（含 [hidden] 是否被反压）。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createDriveSession } from './control-flux.mjs';

const OUT = path.resolve('artifacts/verification/input-dock-redesign');
fs.mkdirSync(OUT, { recursive: true });

const harness = await createDriveSession({
  entry: '/packages/desktop/__tests__/cdp/e2e-acceptance-harness.html',
});

try {
  const empty = await harness.evaluate(`(() => {
    const app = window.cdpApp;
    app.isStreaming = true;
    app.render();
    const ta = document.getElementById('dock-prompt-input');
    ta.value = '';
    const queue = document.getElementById('dock-queue-btn');
    queue.hidden = true;
    const stop = document.getElementById('dock-stop-btn');
    const stack = document.querySelector('.composer-action-stack');
    return {
      queueDisplay: getComputedStyle(queue).display,
      queueVisiblePixels: queue.getBoundingClientRect().height,
      stopDisplay: getComputedStyle(stop).display,
      stopColor: getComputedStyle(stop.querySelector('.composer-stop__block')).backgroundColor,
      stackHeight: stack.getBoundingClientRect().height,
      footerHeight: document.querySelector('.composer-dock__footer').getBoundingClientRect().height,
    };
  })()`);
  console.log('EMPTY RUNNING', JSON.stringify(empty, null, 2));

  const rect = await harness.evaluate(`(() => {
    const el = document.querySelector('.input-dock-container');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  const shot = await harness.sendCommand('Page.captureScreenshot', {
    format: 'png',
    clip: { x: rect.x - 16, y: rect.y - 16, width: rect.width + 32, height: rect.height + 32, scale: 2 },
  });
  fs.writeFileSync(path.join(OUT, 'zoom-running-empty.png'), Buffer.from(shot.data, 'base64'));

  // 有草稿：入队可见、停止在下
  const draft = await harness.evaluate(`(() => {
    const queue = document.getElementById('dock-queue-btn');
    queue.hidden = false;
    const qr = queue.getBoundingClientRect();
    const sr = document.getElementById('dock-stop-btn').getBoundingClientRect();
    return {
      queueDisplay: getComputedStyle(queue).display,
      queueAboveStop: qr.top < sr.top,
      stackHeight: document.querySelector('.composer-action-stack').getBoundingClientRect().height,
    };
  })()`);
  console.log('DRAFT RUNNING', JSON.stringify(draft, null, 2));

  const rect2 = await harness.evaluate(`(() => {
    const el = document.querySelector('.input-dock-container');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  const shot2 = await harness.sendCommand('Page.captureScreenshot', {
    format: 'png',
    clip: { x: rect2.x - 16, y: rect2.y - 16, width: rect2.width + 32, height: rect2.height + 32, scale: 2 },
  });
  fs.writeFileSync(path.join(OUT, 'zoom-running-draft.png'), Buffer.from(shot2.data, 'base64'));
} finally {
  await harness.cleanup();
}
