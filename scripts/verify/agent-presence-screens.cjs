/**
 * 在场指示器实景截图（真实 Blink，加载 9140 开发服务的真实应用）
 *
 * 【为什么要截真实应用而不是桩 DOM】桩 DOM 只能证明 CSS 写对了，
 *   证明不了「它在真实对话区顶部、真实会话内容之上，看起来是什么样」。
 *   这里直接打开开发服务器，注入不同状态，截图存 artifacts/verification/。
 */

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'artifacts/verification');
const URL = process.env.PRESENCE_URL || 'http://127.0.0.1:9140/';

const SCENES = [
  ['idle', 'idle', null],
  ['thinking', 'thinking', '正在思考'],
  ['tool-read', 'tool', '正在读 core/gateway.ts'],
  ['writing', 'writing', '努力工作中'],
  ['delegating', 'delegating', '正在派活给 flux-code-reviewer'],
  ['failed', 'failed', '卡住了：工具超时 60s'],
];

/** 把指示器插进真实对话区顶部（复用应用已有的 .flux-middle-pod） */
function injectScript(kind, text) {
  return `(() => {
    document.querySelectorAll('.conv-presence').forEach((n) => n.remove());
    const pod = document.querySelector('.flux-middle-pod') || document.body;
    const host = document.createElement('div');
    host.innerHTML = \`
      <div class="conv-presence" data-presence="${kind}" data-mode="solo" data-tone="fresh" role="status" aria-label="Agent 当前状态">
        <div class="conv-presence__avatars" data-blinkable="${kind === 'failed' ? 'false' : 'true'}">
          <span class="conv-presence__avatar" data-speaker="true" data-lead="true">
            <span class="conv-presence__halo"></span>
            <span class="conv-presence__ring"></span>
            <span class="conv-presence__face" data-blink="false">
              <svg width="56" height="56" viewBox="0 0 36 36" fill="none">
                <rect x="4" y="4" width="28" height="28" rx="14" fill="var(--foreground)"/>
                <g class="conv-presence__eyes">
                  <circle cx="13.5" cy="17" r="1.9" fill="#18181B"/>
                  <circle cx="22.5" cy="17" r="1.9" fill="#18181B"/>
                </g>
              </svg>
            </span>
          </span>
        </div>
        <span class="conv-presence__text" data-empty="${kind === 'idle' ? 'true' : 'false'}">
          ${text ? `<span class="conv-presence__verb">${text}</span>` : ''}
          ${kind === 'writing' ? '<span class="conv-presence__bars" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}
        </span>
      </div>\`;
    pod.appendChild(host.firstElementChild);
    return true;
  })()`;
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 820,
    backgroundColor: '#0E0F13',
    webPreferences: { offscreen: true },
  });

  await win.loadURL(URL);
  // 等首屏 React 挂载与网关握手（无网关时会落在连接面板，也照样能截到壳）
  await new Promise((r) => setTimeout(r, 3500));

  fs.mkdirSync(OUT, { recursive: true });
  const report = [];

  for (const [label, kind, text] of SCENES) {
    await win.webContents.executeJavaScript(injectScript(kind, text), true);
    await new Promise((r) => setTimeout(r, 900));

    const geo = await win.webContents.executeJavaScript(`(() => {
      const el = document.querySelector('.conv-presence');
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      const face = el.querySelector('.conv-presence__face');
      const fr = face.getBoundingClientRect();
      const cs = getComputedStyle(face);
      return {
        found: true,
        top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height),
        faceSize: Math.round(fr.width), faceLeft: Math.round(fr.left),
        animName: cs.animationName, opacity: cs.opacity,
      };
    })()`, true);

    const image = await win.webContents.capturePage();
    const file = path.join(OUT, `agent-presence-${label}.png`);
    fs.writeFileSync(file, image.toPNG());
    report.push({ label, kind, ...geo });
    console.log(`${label.padEnd(12)} ${geo.found ? `top=${geo.top} h=${geo.height} face=${geo.faceSize}px anim=${geo.animName}` : 'NOT FOUND'}`);
  }

  // 群聊形态
  await win.webContents.executeJavaScript(`(() => {
    document.querySelectorAll('.conv-presence').forEach((n) => n.remove());
    const pod = document.querySelector('.flux-middle-pod') || document.body;
    const host = document.createElement('div');
    const names = ['小发王', '审核官', '测试员', '架构师'];
    host.innerHTML = \`
      <div class="conv-presence" data-presence="tool" data-mode="group" data-tone="fresh" role="status" aria-label="Agent 当前状态">
        <div class="conv-presence__avatars" data-blinkable="true">
          \${names.map((n, i) => \`
            <span class="conv-presence__avatar" data-speaker="\${i === 0}" data-lead="\${i === 0}">
              \${i === 0 ? '<span class="conv-presence__halo"></span><span class="conv-presence__ring"></span>' : ''}
              <span class="conv-presence__face" data-blink="false">
                <svg width="56" height="56" viewBox="0 0 36 36" fill="none">
                  <rect x="4" y="4" width="28" height="28" rx="14" fill="var(--foreground)"/>
                  <g class="conv-presence__eyes">
                    <circle cx="13.5" cy="17" r="1.9" fill="#18181B"/>
                    <circle cx="22.5" cy="17" r="1.9" fill="#18181B"/>
                  </g>
                </svg>
              </span>
            </span>\`).join('')}
        </div>
        <span class="conv-presence__text" data-empty="false">
          <span class="conv-presence__prefix">小发王</span><span class="conv-presence__sep">·</span>
          <span class="conv-presence__verb">正在读</span><span class="conv-presence__target">core/gateway.ts</span>
        </span>
      </div>\`;
    pod.appendChild(host.firstElementChild);
    return true;
  })()`, true);
  await new Promise((r) => setTimeout(r, 900));
  const groupGeo = await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('.conv-presence');
    const r = el.getBoundingClientRect();
    const avatars = el.querySelectorAll('.conv-presence__avatar');
    return { found: true, top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width), avatars: avatars.length };
  })()`, true);
  const groupImg = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, 'agent-presence-group.png'), groupImg.toPNG());
  report.push({ label: 'group', kind: 'group', ...groupGeo });
  console.log(`group        top=${groupGeo.top} h=${groupGeo.height} w=${groupGeo.width} avatars=${groupGeo.avatars}`);

  fs.writeFileSync(path.join(OUT, 'agent-presence-screens.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), url: URL, scenes: report }, null, 2));

  const missing = report.filter((r) => !r.found);
  console.log(`\n==== ${report.length - missing.length}/${report.length} 场景已截图 ====`);
  console.log(`输出目录：artifacts/verification/`);
  app.exit(missing.length === 0 ? 0 : 1);
});
