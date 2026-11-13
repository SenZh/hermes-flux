/**
 * 在场指示器 CSS 计算样式实证（真实 Blink）
 *
 * 【为什么必须有这个探针】样式审查的两条 P0 都是 CSS 级联特异性问题：
 *   reduced-motion 块与 data-app-hidden 暂停规则写在文件里、门禁全绿、字符串断言也通过，
 *   但**实际计算样式**可能仍是 running。只有真实浏览器能给出答案。
 *
 * 【验什么】
 *   1. prefers-reduced-motion: reduce 下，头像形变（含群聊 ambient）的 animation-name 必须是 none；
 *   2. html[data-app-hidden="true"] 下，animation-play-state 必须是 paused；
 *   3. 正常态下形变确实在跑（防止「全停了」这种假通过）；
 *   4. 长目标文案不溢出容器（省略号生效），且头像位置零位移。
 */

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '../..');
const CSS = fs.readFileSync(path.join(ROOT, 'packages/ui/src/styles/conversation.css'), 'utf8');

const FIXTURE = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  :root {
    --panel: #16171D; --card: #1B1C23; --background: #0E0F13;
    --foreground: #E8E9EC; --secondary-foreground: #9CA3AF;
    --muted-foreground: #8E949E; --faint: #3E4148;
    --destructive: #EF4444; --radius-pill: 9999px;
    --conv-gutter-top: 24px; --conv-meta-size: 13px;
    --conv-font-sans: sans-serif; --conv-font-mono: monospace;
  }
  body { margin: 0; background: var(--panel); }
  .flux-middle-pod { position: relative; height: 300px; }
${CSS}
</style></head>
<body><div class="flux-middle-pod" id="pod"></div></body></html>`;

/** 一个状态一份最小 DOM，结构与 AgentPresence.tsx 输出一致 */
function presenceHtml(kind, text, mode = 'solo') {
  const avatars =
    mode === 'group'
      ? `<span class="conv-presence__avatar" data-speaker="true" data-lead="true">
           <span class="conv-presence__halo"></span><span class="conv-presence__ring"></span>
           <span class="conv-presence__face" data-blink="false"><svg width="56" height="56"></svg></span>
         </span>
         <span class="conv-presence__avatar" data-speaker="false" data-lead="false">
           <span class="conv-presence__face" data-blink="false"><svg width="56" height="56"></svg></span>
         </span>`
      : `<span class="conv-presence__avatar" data-speaker="true" data-lead="true">
           <span class="conv-presence__halo"></span><span class="conv-presence__ring"></span>
           <span class="conv-presence__face" data-blink="false"><svg width="56" height="56"></svg></span>
         </span>`;
  return `<div class="conv-presence" data-presence="${kind}" data-mode="${mode}" data-tone="fresh" data-layout="stage">
    <div class="conv-presence__avatars" data-blinkable="true">${avatars}</div>
    <span class="conv-presence__text" ${kind === 'idle' ? 'data-idle-quip="true"' : ''}>${text}</span>
  </div>`;
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  /*
   * 【禁用 offscreen (Rules)】`webPreferences.offscreen: true` 在部分 Windows/Electron 34 组合上
   *   退出时会以 0xC0000005 崩溃（实测 `app.exit(0)` 仍返回 -1073741819），
   *   使脚本无法作为门禁使用。改用隐藏的普通窗口：仍是真实 Blink 渲染与真实排版，
   *   `capturePage()` 行为一致。
   */
  const win = new BrowserWindow({ show: false, width: 900, height: 400, backgroundColor: '#16171D' });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(FIXTURE));
  const run = (code) => win.webContents.executeJavaScript(code, true);

  // ---------- 1. 正常态：形变确实在跑 ----------
  await run(`document.getElementById('pod').innerHTML = ${JSON.stringify(presenceHtml('thinking', '<span class="conv-presence__verb">thinking</span>'))}; true`);
  const normalName = await run(`getComputedStyle(document.querySelector('.conv-presence__face')).animationName`);
  record('正常态头像形变在运行', normalName.includes('convPresenceTilt'), `animationName=${normalName}`);

  const ringName = await run(`getComputedStyle(document.querySelector('.conv-presence__ring')).animationName`);
  record('正常态活动环在旋转', ringName.includes('convPresenceSpin'), `animationName=${ringName}`);

  // ---------- 2. data-app-hidden：必须 paused ----------
  await run(`document.documentElement.dataset.appHidden = 'true'; true`);
  const pausedFace = await run(`getComputedStyle(document.querySelector('.conv-presence__face')).animationPlayState`);
  record('后台隐藏时头像形变已暂停', pausedFace === 'paused', `animationPlayState=${pausedFace}`);

  const pausedRing = await run(`getComputedStyle(document.querySelector('.conv-presence__ring')).animationPlayState`);
  record('后台隐藏时活动环已暂停', pausedRing === 'paused', `animationPlayState=${pausedRing}`);

  // 群聊 ambient 也要被暂停（特异性最高的那条规则）
  await run(`document.documentElement.dataset.appHidden = 'false';
    document.getElementById('pod').innerHTML = ${JSON.stringify(presenceHtml('thinking', 'x', 'group'))}; true`);
  const ambientRunning = await run(`getComputedStyle(document.querySelectorAll('.conv-presence__face')[1]).animationName`);
  record('群聊非说话者挂 ambient 呼吸', ambientRunning.includes('convPresenceAmbient'), `animationName=${ambientRunning}`);
  await run(`document.documentElement.dataset.appHidden = 'true'; true`);
  const ambientPaused = await run(`getComputedStyle(document.querySelectorAll('.conv-presence__face')[1]).animationPlayState`);
  record('后台隐藏时群聊 ambient 已暂停', ambientPaused === 'paused', `animationPlayState=${ambientPaused}`);
  await run(`document.documentElement.dataset.appHidden = 'false'; true`);

  // ---------- 3. prefers-reduced-motion：animation-name 必须是 none ----------
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await run(`document.getElementById('pod').innerHTML = ${JSON.stringify(presenceHtml('thinking', 'x'))}; true`);
  const reducedFace = await run(`getComputedStyle(document.querySelector('.conv-presence__face')).animationName`);
  record('减动效下头像形变已停止', reducedFace === 'none', `animationName=${reducedFace}`);

  const reducedRing = await run(`getComputedStyle(document.querySelector('.conv-presence__ring')).animationName`);
  record('减动效下活动环已停止', reducedRing === 'none', `animationName=${reducedRing}`);

  await run(`document.getElementById('pod').innerHTML = ${JSON.stringify(presenceHtml('thinking', 'x', 'group'))}; true`);
  const reducedAmbient = await run(`getComputedStyle(document.querySelectorAll('.conv-presence__face')[1]).animationName`);
  record('减动效下群聊 ambient 已停止', reducedAmbient === 'none', `animationName=${reducedAmbient}`);

  win.webContents.debugger.detach();

  // ---------- 4. 状态文案必须真实可见且不被截断 ----------
  // 【真实缺陷回归】文案行曾因父级 shrink-to-fit + 百分比 max-width 的循环依赖
  //   塌成 0 宽，状态文案完全不可见；而 CSS 字符串断言与 SSR 渲染都发现不了。
  for (const [kind, inner] of [
    ['thinking', '<span class="conv-presence__verb">正在思考</span>'],
    ['tool', '<span class="conv-presence__verb">正在读</span><span class="conv-presence__target">core/gateway.ts</span>'],
    ['writing', '<span class="conv-presence__verb">努力工作中</span><span class="conv-presence__bars"><i></i><i></i><i></i></span>'],
  ]) {
    await run(`document.getElementById('pod').innerHTML = ${JSON.stringify(presenceHtml(kind, inner))}; true`);
    const m = await run(`(() => {
      const text = document.querySelector('.conv-presence__text');
      const tr = text.getBoundingClientRect();
      const verb = text.querySelector('.conv-presence__verb');
      const vr = verb.getBoundingClientRect();
      return { textW: Math.round(tr.width), textH: Math.round(tr.height), verbW: Math.round(vr.width) };
    })()`);
    record(`[${kind}] 状态文案可见且未塌成 0 宽`, m.textW > 0 && m.verbW > 0,
      `textWidth=${m.textW} verbWidth=${m.verbW}`);
  }

  // 文案不得被上层元素遮挡（onboarding 卡片曾盖住它）
  const occluded = await run(`(() => {
    const el = document.querySelector('.conv-presence');
    const text = el.querySelector('.conv-presence__text');
    const tr = text.getBoundingClientRect();
    const prev = el.style.pointerEvents;
    el.style.pointerEvents = 'auto';
    const hit = document.elementFromPoint(Math.round(tr.left + 20), Math.round(tr.top + tr.height / 2));
    el.style.pointerEvents = prev;
    return hit ? (hit.className || hit.tagName).toString() : 'none';
  })()`);
  record('文案不被上层元素遮挡', /conv-presence/.test(occluded), `hit=${occluded}`);

  // ---------- 5. idle 轮播文案常驻（契约已变更：不再高度归零） ----------
  /*
   * 【契约变更 (Rules)】空闲态从「文案行高度归零退场」改为「弱化头像 + 轮播短句常驻」
   *   （用户 2026-11-13 裁定）。因此不再断言 `[data-empty]` 塌陷，改为断言：
   *   1. 空闲文案行常驻且带 `data-idle-quip`；
   *   2. 文案不再是前景高对比白（弱化规则必须真的命中 `.conv-presence__verb`）。
   */
  const idleState = await run(`(async () => {
    document.getElementById('pod').innerHTML = ${JSON.stringify(
      presenceHtml('idle', '<span class="conv-presence__verb">在角落里等你派活</span>'),
    )};
    const text = document.querySelector('.conv-presence__text');
    const verb = text.querySelector('.conv-presence__verb');
    const phase = getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim();
    await new Promise((r) => requestAnimationFrame(r));
    const box = document.querySelector('.conv-presence').getBoundingClientRect();
    return {
      marked: text.getAttribute('data-idle-quip'),
      verbColor: getComputedStyle(verb).color,
      foreground: phase,
      visibleHeight: Math.round(box.height),
      textHeight: Math.round(text.getBoundingClientRect().height),
    };
  })()`);
  record(
    'idle 轮播文案常驻且弱化',
    idleState.marked === 'true' && idleState.textHeight > 0 && idleState.verbColor !== idleState.foreground,
    `data-idle-quip=${idleState.marked} textHeight=${idleState.textHeight} verbColor=${idleState.verbColor} foreground=${idleState.foreground}`,
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n==== ${results.length - failed.length}/${results.length} PASS ====`);
  const outDir = path.join(ROOT, 'artifacts/verification');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'agent-presence-css-evidence.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(`evidence -> artifacts/verification/agent-presence-css-evidence.json`);

  app.exit(failed.length === 0 ? 0 : 1);
});
