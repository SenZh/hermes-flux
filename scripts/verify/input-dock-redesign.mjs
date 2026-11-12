/**
 * 输入舱重设计最终取证：真实 Blink 渲染 + 几何/状态量取 + 截图落盘。
 *
 * 覆盖：深浅两皮肤、空闲/运行两态、模型浮层、审批菜单、队列托盘、附件轨、220px 触顶。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createDriveSession } from './control-flux.mjs';

const OUT = path.resolve('artifacts/verification/input-dock-redesign');
fs.mkdirSync(OUT, { recursive: true });

const session = await createDriveSession({ entry: '/packages/desktop/dist/renderer/index.html' });
const evidence = {};

const applyState = async (patch) =>
  session.evaluate(`(() => {
    const s = window.__fluxState;
    Object.assign(s, ${JSON.stringify(patch)});
    window.__fluxRender();
    return true;
  })()`);

const measure = async (expr) => session.evaluate(expr);

try {
  // ---------- 深色 · 空闲 ----------
  await applyState({
    gatewayConnected: true,
    gatewayConnecting: false,
    isStreaming: false,
    dockNotice: '',
    attachments: [],
    queuedMessages: [],
    modelMenuOpen: false,
    theme: 'obsidian-gold',
    availableModels: ['anthropic/claude-opus-4.8', 'openai/gpt-5.2', 'google/gemini-3.8-flash'],
  });

  evidence.idle = await measure(`(() => {
    const dock = document.querySelector('.composer-dock');
    const ta = document.getElementById('dock-prompt-input');
    const cs = getComputedStyle(dock);
    const taCs = getComputedStyle(ta);
    return {
      dockMaxWidth: cs.maxWidth,
      dockBackground: cs.backgroundColor,
      dockBorder: cs.borderTopWidth + ' ' + cs.borderTopColor,
      dockShadow: cs.boxShadow,
      dockRadius: cs.borderRadius,
      textareaMinHeight: taCs.minHeight,
      textareaMaxHeight: taCs.maxHeight,
      textareaHeight: ta.offsetHeight,
      hasSend: Boolean(document.getElementById('dock-send-btn')),
      hasStop: Boolean(document.getElementById('dock-stop-btn')),
      hasCollapseBtn: Boolean(document.getElementById('dock-input-collapse-toggle')),
      approvalOptions: document.querySelectorAll('.composer-approval-option').length,
    };
  })()`);

  // ---------- 弹性增高 ----------
  evidence.grown = await measure(`(() => {
    const ta = document.getElementById('dock-prompt-input');
    ta.focus();
    ta.value = Array.from({ length: 30 }, (_, i) => '第 ' + (i + 1) + ' 行：验证输入区弹性增高与内部滚动').join('\\n');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return { height: ta.offsetHeight, scrollHeight: ta.scrollHeight, overflowY: getComputedStyle(ta).overflowY };
  })()`);

  evidence.shrunk = await measure(`(() => {
    const ta = document.getElementById('dock-prompt-input');
    ta.value = '一行';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return { height: ta.offsetHeight };
  })()`);

  // ---------- 附件轨 + 队列托盘 ----------
  await applyState({
    attachments: [
      { id: 'a1', name: 'shot.png', type: 'image', previewUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="%23C2A184"/></svg>' },
      { id: 'a2', name: 'brief.pdf', type: 'pdf' },
    ],
    queuedMessages: [
      { id: 'adm-1', admissionId: 'adm-1', text: '把设置页的模型下拉也换成同一套浮层' },
      { id: 'adm-2', admissionId: 'adm-2', text: '跑一遍浅色皮肤的对比度检查' },
    ],
  });

  evidence.railAndQueue = await measure(`(() => {
    const rail = document.querySelector('.composer-attach-rail');
    const tray = document.querySelector('.pending-queue-tray');
    const dock = document.querySelector('.composer-dock');
    const thumb = document.querySelector('.composer-attach-thumb');
    return {
      hasRail: Boolean(rail),
      railBeforeDock: rail ? (rail.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 : false,
      thumbSize: thumb ? thumb.offsetWidth + 'x' + thumb.offsetHeight : '',
      queueRows: document.querySelectorAll('.pending-queue-row').length,
      queueActions: [...document.querySelectorAll('.queue-action-btn')].map((b) => b.dataset.action),
    };
  })()`);

  await session.screenshot(path.join(OUT, 'dark-idle-full.png'));

  // ---------- 模型浮层 ----------
  await applyState({ modelMenuOpen: true, modelSearchQuery: '' });
  evidence.menu = await measure(`(() => {
    const d = document.getElementById('dock-model-dropdown');
    const r = d.getBoundingClientRect();
    return {
      display: d.style.display,
      width: Math.round(r.width),
      rows: document.querySelectorAll('.model-option').length,
      triggerText: (document.getElementById('dock-model-selector-btn') || {}).textContent.replace(/\\s+/g, ' ').trim(),
      cascadeHidden: (document.getElementById('model-reasoning-cascade') || {}).style?.display,
    };
  })()`);
  await session.screenshot(path.join(OUT, 'dark-model-menu.png'));

  // ---------- 审批菜单 ----------
  await applyState({ modelMenuOpen: false });
  await measure(`(() => { document.getElementById('dock-approval-dropdown').style.display = 'block'; return true; })()`);
  evidence.approval = await measure(`(() => {
    const dd = document.getElementById('dock-approval-dropdown');
    const r = dd.getBoundingClientRect();
    return {
      width: Math.round(r.width),
      options: document.querySelectorAll('.composer-approval-option').length,
      checked: [...document.querySelectorAll('.composer-approval-option[aria-checked="true"]')].map((e) => e.dataset.mode),
    };
  })()`);
  await session.screenshot(path.join(OUT, 'dark-approval.png'));

  // ---------- 运行态 ----------
  // 【规则】生产渲染器的 isStreaming 由 activeStreamingStoredSessionId 与当前会话双条件决定，
  //   外部无法只翻一个布尔。运行态取证改走 e2e harness（同一份 renderInputDock 产物）。

  // ---------- 浅色 ----------
  await applyState({ isStreaming: false, theme: 'ayu-light' });
  evidence.light = await measure(`(() => {
    const dock = document.querySelector('.composer-dock');
    const cs = getComputedStyle(dock);
    const ta = document.getElementById('dock-prompt-input');
    const root = getComputedStyle(document.documentElement);
    return {
      dockBackground: cs.backgroundColor,
      dockBorder: cs.borderTopColor,
      dockShadow: cs.boxShadow,
      dockMaxWidth: cs.maxWidth,
      textareaColor: getComputedStyle(ta).color,
      stagePanel: root.getPropertyValue('--panel').trim(),
      inputSlot: root.getPropertyValue('--input').trim(),
      borderSlot: root.getPropertyValue('--border').trim(),
    };
  })()`);
  await session.screenshot(path.join(OUT, 'light-idle.png'));

  await applyState({ modelMenuOpen: true });
  await session.screenshot(path.join(OUT, 'light-model-menu.png'));

  fs.writeFileSync(path.join(OUT, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await session.cleanup();
}

// ---------- 运行态：走 e2e harness ----------
const harness = await createDriveSession({
  entry: '/packages/desktop/__tests__/cdp/e2e-acceptance-harness.html',
});
try {
  evidence.running = await harness.evaluate(`(() => {
    const app = window.cdpApp;
    app.isStreaming = true;
    app.render();
    const stop = document.getElementById('dock-stop-btn');
    const block = stop ? stop.querySelector('.composer-stop__block') : null;
    const cs = block ? getComputedStyle(block) : null;
    const footer = document.querySelector('.composer-dock__footer');
    const stack = document.querySelector('.composer-action-stack');
    return {
      hasSend: Boolean(document.getElementById('dock-send-btn')),
      hasQueue: Boolean(document.getElementById('dock-queue-btn')),
      queueHidden: (document.getElementById('dock-queue-btn') || {}).hidden,
      stopLabel: stop ? stop.getAttribute('aria-label') : '',
      stopText: stop ? stop.textContent.trim() : '',
      blockSize: cs ? cs.width + 'x' + cs.height : '',
      blockColor: cs ? cs.backgroundColor : '',
      blockRadius: cs ? cs.borderRadius : '',
      blockAnimation: cs ? cs.animationName : '',
      footerHeight: footer ? footer.offsetHeight : 0,
      stackHeight: stack ? stack.offsetHeight : 0,
    };
  })()`);
  await harness.screenshot(path.join(OUT, 'dark-running.png'));

  // 运行中 + 有草稿：发送（入队）叠在停止上方，按钮列变高。
  // 【说明】harness 不挂生产宿主的 bindEvents，hidden 的切换由宿主在 input 事件里完成；
  //   这里直接复现宿主那一步，验证的是 CSS 布局与可见性契约本身。
  evidence.runningWithDraft = await harness.evaluate(`(() => {
    const queue = document.getElementById('dock-queue-btn');
    const stop = document.getElementById('dock-stop-btn');
    queue.hidden = false;
    const stack = document.querySelector('.composer-action-stack');
    const footer = document.querySelector('.composer-dock__footer');
    const qr = queue.getBoundingClientRect();
    const sr = stop.getBoundingClientRect();
    return {
      queueVisible: getComputedStyle(queue).display !== 'none',
      queueLabel: queue.getAttribute('aria-label'),
      queueAboveStop: qr.top < sr.top,
      stackHeight: stack.offsetHeight,
      footerHeight: footer.offsetHeight,
      stopBlockColor: getComputedStyle(stop.querySelector('.composer-stop__block')).backgroundColor,
    };
  })()`);
  await harness.screenshot(path.join(OUT, 'dark-running-draft.png'));

  fs.writeFileSync(path.join(OUT, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log('RUNNING', JSON.stringify(evidence.running, null, 2));
  console.log('RUNNING+DRAFT', JSON.stringify(evidence.runningWithDraft, null, 2));
} finally {
  await harness.cleanup();
}

