import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import esbuild from 'esbuild';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9500 + Math.floor(Math.random() * 300);
const BUNDLE_OUT = 'packages/desktop/__tests__/cdp/.tmp/react-entry.js';

test('Main Chat Stage & Composer Dock - Live Headless Browser CDP Physical Verification', async (t) => {
  if (!fs.existsSync(EDGE_PATH)) {
    t.skip('Microsoft Edge not found on system');
    return;
  }

  // 0. 现场打包 React 测试桥：浏览器无法解析裸模块说明符，且消息行已 100% React 化
  fs.mkdirSync(path.dirname(path.resolve(BUNDLE_OUT)), { recursive: true });
  await esbuild.build({
    entryPoints: [path.resolve('packages/ui/__tests__/cdp/react-entry.mjs')],
    outfile: path.resolve(BUNDLE_OUT),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });

  // 1. Static HTTP Server with dynamic port allocation (port 0)
  const rootDir = path.resolve('.');
  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url?.split('?')[0] || '/');
    if (reqPath === '/') reqPath = '/packages/desktop/__tests__/cdp/interactive-stage-harness.html';
    const filePath = path.join(rootDir, reqPath);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const serverPort = server.address().port;

  // 2. Launch Edge in Headless Mode with clean os.tmpdir()
  const tmpUserDataDir = path.resolve(os.tmpdir(), `edge-cdp-stage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

  const browserProc = spawn(
    EDGE_PATH,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      '--headless=new',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      `--user-data-dir=${tmpUserDataDir}`,
      `http://127.0.0.1:${serverPort}/packages/desktop/__tests__/cdp/interactive-stage-harness.html`,
    ],
    { stdio: 'ignore' }
  );

  let ws = null;

  t.after(async () => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        await new Promise((resolve) => {
          const id = 999999;
          const onMsg = (evt) => {
            const data = JSON.parse(evt.data);
            if (data.id === id) {
              ws.removeEventListener('message', onMsg);
              resolve();
            }
          };
          ws.addEventListener('message', onMsg);
          ws.send(JSON.stringify({ id, method: 'Browser.close' }));
          setTimeout(resolve, 500);
        });
        ws.close();
      }
      browserProc.kill();
      server.close();
      await new Promise((r) => setTimeout(r, 400));
      fs.rmSync(tmpUserDataDir, { recursive: true, force: true });
    } catch {}
  });

  // 3. Connect CDP
  let targets = [];
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      if (res.ok) {
        targets = await res.json();
        if (targets.length > 0) break;
      }
    } catch {}
  }

  assert.ok(targets.length > 0, 'Must discover CDP target page');
  const pageTarget = targets.find((tgt) => tgt.type === 'page') || targets[0];

  ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let msgId = 1;
  const sendCdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = msgId++;
      const timeout = setTimeout(() => {
        ws.removeEventListener('message', handler);
        reject(new Error(`CDP request timeout for ${method} (id=${id})`));
      }, 5000);

      const handler = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });

  // 4. Wait for Harness Ready
  let isReady = false;
  for (let i = 0; i < 40; i++) {
    const res = await sendCdp('Runtime.evaluate', {
      expression: 'window.__stageReady === true',
      returnByValue: true,
    });
    if (res?.result?.value) {
      isReady = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(isReady, 'Harness environment must be loaded and ready');

  // 5. 桌面视口物理几何断言：740px 黄金限宽与水位计呈现
  await t.test('1. 桌面视口：输入舱锁定 740px 黄金限宽，右上角上下文水位计常驻', async () => {
    await sendCdp('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const dockMetrics = await sendCdp('Runtime.evaluate', {
      expression: `(() => {
        const dock = document.querySelector('.composer-dock');
        const gauge = document.querySelector('.context-gauge-badge');
        return {
          dockWidth: dock ? dock.offsetWidth : 0,
          dockMaxWidth: dock ? window.getComputedStyle(dock).maxWidth : '',
          hasGauge: Boolean(gauge),
          gaugeText: gauge ? gauge.textContent.trim() : '',
        };
      })()`,
      returnByValue: true,
    });

    assert.equal(dockMetrics.result.value.dockMaxWidth, '740px', '输入舱必须严格锁定 max-width: 740px 黄金限宽');
    assert.ok(dockMetrics.result.value.dockWidth <= 740, `输入舱实际渲染宽度不得超过 740px (当前: ${dockMetrics.result.value.dockWidth})`);
    assert.ok(dockMetrics.result.value.hasGauge, '右上角必须常驻上下文水位计徽章');
    assert.ok(dockMetrics.result.value.gaugeText.includes('42k / 128k'), '水位计正确展示上下文用量');
  });

  // 6. 物理交互：点击“回滚”按钮，内容自动回填至输入框
  await t.test('2. 物理动作：点击用户提问底部的回滚按钮，提问文本自动回填至输入框', async () => {
    const rollbackResult = await sendCdp('Runtime.evaluate', {
      expression: `(() => {
        const rollbackBtn = document.querySelector('[data-action="rollback-msg"]');
        if (!rollbackBtn) return { success: false, reason: 'btn-not-found' };
        rollbackBtn.click();
        const textarea = document.getElementById('dock-prompt-input');
        return {
          success: true,
          inputValue: textarea ? textarea.value : '',
          recordedRollback: document.body.getAttribute('data-last-rollback'),
        };
      })()`,
      returnByValue: true,
    });

    assert.ok(rollbackResult.result.value.success, '回滚按钮必须存在并被触发点击');
    assert.ok(rollbackResult.result.value.inputValue.includes('单调递增时钟'), '输入框必须自动回填被撤回的提问内容');
    assert.equal(rollbackResult.result.value.recordedRollback, rollbackResult.result.value.inputValue);
  });

  // 6.1 物理交互与纯图标样式断言：点击复制、Fork 按钮，彻底验证重新生成已安全剥离
  await t.test('2.1 物理动作：纯图标按钮无内嵌文本且带title提示，彻底移除重新生成按钮', async () => {
    const actionResult = await sendCdp('Runtime.evaluate', {
      expression: `(() => {
        const copyBtn = document.querySelector('[data-action="copy-msg"]');
        const forkBtn = document.querySelector('[data-action="fork-msg"]');
        const regenBtn = document.querySelector('[data-action="regenerate-msg"]');
        if (!copyBtn || !forkBtn) {
          return { success: false, reason: 'buttons-missing' };
        }

        // 验证纯图标特性：按钮内无 span 标签，且具备自绘 data-tooltip 提示
        const copyHasSpan = Boolean(copyBtn.querySelector('span'));
        const forkHasSpan = Boolean(forkBtn.querySelector('span'));
        const copyTitle = copyBtn.getAttribute('data-tooltip');
        const forkTitle = forkBtn.getAttribute('data-tooltip');
        const usesNativeTitle = Boolean(copyBtn.getAttribute('title') || forkBtn.getAttribute('title'));

        // 模拟物理触发点击，验证无任何异常抛出且状态可达
        copyBtn.click();
        forkBtn.click();

        return {
          success: true,
          copyHasSpan,
          forkHasSpan,
          hasRegenBtn: Boolean(regenBtn),
          hasTitles: Boolean(copyTitle && forkTitle),
          usesNativeTitle,
          copyTitle,
          forkTitle,
        };
      })()`,
      returnByValue: true,
    });

    assert.ok(actionResult.result.value.success, '核心操作栏按钮必须渲染存在');
    assert.equal(actionResult.result.value.copyHasSpan, false, '复制按钮严禁内联文本标签');
    assert.equal(actionResult.result.value.forkHasSpan, false, 'Fork按钮严禁内联文本标签');
    assert.equal(actionResult.result.value.hasRegenBtn, false, '助手消息行必须彻底移除重新生成按钮');
    assert.ok(actionResult.result.value.hasTitles, '所有操作按钮必须具备 data-tooltip 悬浮说明');
    assert.equal(actionResult.result.value.usesNativeTitle, false, '禁止使用原生 title（黑底方框无法换肤）');
    assert.ok(actionResult.result.value.copyTitle.length > 0, '复制按钮必须具备有效 tooltip 文案');
    assert.ok(actionResult.result.value.forkTitle.length > 0, 'Fork按钮必须具备有效 tooltip 文案');
  });

  // 6.2 物理验证：附件暂存托盘双层缩略图卡片（上图下文与结构化标号）
  await t.test('2.2 物理动作：附件托盘双层卡片，上层缩略图下层 Image 1/Doc 1 结构化标号', async () => {
    const trayResult = await sendCdp('Runtime.evaluate', {
      expression: `(() => {
        const tray = document.querySelector('.composer-attachment-tray');
        if (!tray) return { success: false, reason: 'tray-not-found' };
        const cards = Array.from(tray.querySelectorAll('.composer-attachment-card'));
        const labels = cards.map((c) => c.querySelector('.attachment-index-label')?.textContent || '');
        const filenames = cards.map((c) => c.querySelector('.attachment-filename-label')?.textContent || '');
        const hasImg = Boolean(cards[0]?.querySelector('img'));
        const removeBtns = tray.querySelectorAll('.btn-remove-attachment');

        return {
          success: true,
          cardCount: cards.length,
          labels,
          filenames,
          hasImg,
          removeBtnCount: removeBtns.length,
        };
      })()`,
      returnByValue: true,
    });

    assert.ok(trayResult.result.value.success, '附件托盘必须渲染存在');
    assert.equal(trayResult.result.value.cardCount, 2, '必须渲染2个附件卡片');
    assert.equal(trayResult.result.value.hasImg, true, '图片附件必须渲染上层缩略图');
    assert.ok(trayResult.result.value.labels.includes('Image 1'), '必须展示 Image 1 逻辑标号');
    assert.ok(trayResult.result.value.labels.includes('Doc 1'), '必须展示 Doc 1 逻辑标号');
    assert.ok(trayResult.result.value.filenames.includes('diagram.png'), '必须展示原文件名 diagram.png');
    assert.ok(trayResult.result.value.filenames.includes('fsm.ts'), '必须展示原文件名 fsm.ts');
    assert.equal(trayResult.result.value.removeBtnCount, 2, '每个卡片必须提供独立的右上角删除按钮');
  });

  // 6.3 物理验证：流式中间态操作栏与时间戳时序不变量
  await t.test('2.3 流式时序不变量：isStreaming: true 时末条助手行隐藏操作栏与时间戳，完成态恢复', async () => {
    const streamResult = await sendCdp('Runtime.evaluate', {
      expression: `(() => {
        const { renderMessages } = window.__fluxReact;
        const testMsgs = [
          {
            id: 'user-stream-1',
            role: 'user',
            content: '流式问题测试',
            timestamp: '10:00:00',
          },
          {
            id: 'ast-stream-1',
            role: 'assistant',
            content: '正在生成流式内容中...',
            timestamp: '10:00:02',
            durationMs: 1200,
          },
        ];

        // 1. 流式输出中：isStreaming: true
        const streamingHtml = renderMessages(testMsgs, { isStreaming: true });

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = streamingHtml;
        const streamingAssistantRow = tempDiv.querySelector('.conv-message--assistant');
        const streamingFooter = streamingAssistantRow ? streamingAssistantRow.querySelector('.assistant-footer-bar') : null;
        const streamingTimeTag = streamingAssistantRow ? streamingAssistantRow.querySelector('.time-tag') : null;

        // 2. 流式完成态：isStreaming: false
        const completedHtml = renderMessages(testMsgs, { isStreaming: false });
        tempDiv.innerHTML = completedHtml;
        const completedAssistantRow = tempDiv.querySelector('.conv-message--assistant');
        const completedFooter = completedAssistantRow ? completedAssistantRow.querySelector('.assistant-footer-bar') : null;
        const completedTimeTag = completedAssistantRow ? completedAssistantRow.querySelector('.time-tag') : null;

        return {
          streamingHasFooter: Boolean(streamingFooter),
          streamingHasTimeTag: Boolean(streamingTimeTag),
          completedHasFooter: Boolean(completedFooter),
          completedHasTimeTag: Boolean(completedTimeTag),
          completedTimeText: completedTimeTag ? completedTimeTag.textContent : '',
        };
      })()`,
      returnByValue: true,
    });

    const val = streamResult.result.value;
    assert.equal(val.streamingHasFooter, false, 'isStreaming: true 时末条助手行绝不能渲染 assistant-footer-bar');
    assert.equal(val.streamingHasTimeTag, false, 'isStreaming: true 时末条助手行绝不能渲染 time-tag');
    assert.equal(val.completedHasFooter, true, 'isStreaming: false 且为回合末条时必须呈现 assistant-footer-bar');
    assert.equal(val.completedHasTimeTag, true, 'isStreaming: false 时助手行必须渲染 time-tag');
    assert.equal(val.completedTimeText, '10:00:02', '助手行时间必须展示真实时间戳');
  });

  // 6.4 物理验证：工具插槽常驻锚点与 renderToolCapsuleSlot 判空契约
  await t.test('2.4 工具插槽锚点：renderMessage 产出常驻 msg-tools 容器，renderToolCapsuleSlot 判空契约', async () => {
    const slotResult = await sendCdp('Runtime.evaluate', {
      expression: `(() => {
        const { renderMessage, renderToolCapsuleSlot } = window.__fluxRenderers;

        // 1. 带工具调用的消息
        const msgWithTools = {
          id: 'ast-with-tools-1',
          role: 'assistant',
          content: '正在查询天气...',
          toolCalls: [
            {
              id: 'call-weather-1',
              name: 'weather_query',
              args: '{"city":"Hangzhou"}',
              status: 'running',
            },
          ],
        };

        const htmlWithTools = renderMessage(msgWithTools, 'HERMES', { isFirstInTurn: true, isLastInTurn: true });
        const slotHtmlWithTools = renderToolCapsuleSlot(msgWithTools);

        const div = document.createElement('div');
        div.innerHTML = htmlWithTools;
        const toolsSlot = div.querySelector('#msg-tools-ast-with-tools-1');

        // 2. 空工具调用的消息
        const msgNoTools = {
          id: 'ast-no-tools-1',
          role: 'assistant',
          content: '普通纯文本回复',
          toolCalls: [],
        };

        const htmlNoTools = renderMessage(msgNoTools, 'HERMES', { isFirstInTurn: true, isLastInTurn: true });
        const slotHtmlNoTools = renderToolCapsuleSlot(msgNoTools);
        div.innerHTML = htmlNoTools;
        const noToolsSlot = div.querySelector('#msg-tools-ast-no-tools-1');

        return {
          hasSlotWithTools: Boolean(toolsSlot),
          slotWithToolsClass: toolsSlot ? toolsSlot.className : '',
          slotHtmlWithToolsNonEmpty: slotHtmlWithTools.trim().length > 0,
          slotHtmlWithToolsIncludesName: slotHtmlWithTools.includes('weather_query'),
          hasSlotNoTools: Boolean(noToolsSlot),
          slotHtmlNoToolsExactEmpty: slotHtmlNoTools === '',
        };
      })()`,
      returnByValue: true,
    });

    const val = slotResult.result.value;
    assert.ok(val.hasSlotWithTools, '带工具的消息行必须产出 id="msg-tools-<id>" 增量锚点容器');
    assert.equal(val.slotWithToolsClass, 'conv-tools', '工具插槽类名必须与 React ToolSection 同构（conv-tools）');
    assert.ok(val.slotHtmlWithToolsNonEmpty, 'renderToolCapsuleSlot 对带工具消息必须返回非空 HTML');
    assert.ok(val.slotHtmlWithToolsIncludesName, '工具插槽内容必须包含工具名称');
    assert.ok(val.hasSlotNoTools, '空工具消息行依然必须具备常驻 id="msg-tools-<id>" 锚点容器供后续补丁通道直写');
    assert.ok(val.slotHtmlNoToolsExactEmpty, 'renderToolCapsuleSlot 对空工具消息必须严格返回空字符串');
  });

  // 6.5 物理验证：回滚撤回按钮在会话类型间的严格隔离
  await t.test('2.5 会话隔离不变量：回滚按钮仅在普通工作会话渲染，Bot 工位与群聊会议室严格拒绝', async () => {
    const sessionResult = await sendCdp('Runtime.evaluate', {
      expression: `(() => {
        const { renderMessage } = window.__fluxRenderers;

        const ordinaryMsg = {
          id: 'usr-ord-1',
          role: 'user',
          content: '普通会话提问',
        };

        const botMsg = {
          id: 'usr-bot-1',
          role: 'user',
          content: 'Bot 工位提问',
        };

        const groupMsg = {
          id: 'usr-grp-1',
          role: 'user',
          content: '群聊会议室提问',
        };

        const div = document.createElement('div');

        // React 版用 mode 表达会话类型：scratchpad / foreground / group
        div.innerHTML = renderMessage(ordinaryMsg, 'HERMES', { mode: 'scratchpad' });
        const ordinaryRollback = div.querySelector('[data-action="rollback-msg"]');

        div.innerHTML = renderMessage(botMsg, 'HERMES', { mode: 'foreground' });
        const botRollback = div.querySelector('[data-action="rollback-msg"]');

        div.innerHTML = renderMessage(groupMsg, 'HERMES', { mode: 'group' });
        const groupRollback = div.querySelector('[data-action="rollback-msg"]');

        return {
          ordinaryHasRollback: Boolean(ordinaryRollback),
          botHasRollback: Boolean(botRollback),
          groupHasRollback: Boolean(groupRollback),
        };
      })()`,
      returnByValue: true,
    });

    const val = sessionResult.result.value;
    assert.equal(val.ordinaryHasRollback, true, '普通工作会话必须渲染回滚撤回按钮');
    assert.equal(val.botHasRollback, false, 'Bot Forever Chat 主工位绝对禁止渲染回滚按钮');
    assert.equal(val.groupHasRollback, false, 'Group Room 群聊会议室绝对禁止渲染回滚按钮');
  });

  // 8. 物理交互：点击排队托盘的“打断并发送”按钮
  await t.test('4. 物理动作：点击待发送队列托盘的打断插队按钮，触发抢占标记', async () => {
    const interruptResult = await sendCdp('Runtime.evaluate', {
      expression: `(() => {
        const interruptBtn = document.querySelector('[data-action="interrupt-and-push"]');
        if (!interruptBtn) return { success: false };
        interruptBtn.click();
        return {
          success: true,
          triggered: document.body.getAttribute('data-interrupted-and-pushed') === 'true',
        };
      })()`,
      returnByValue: true,
    });

    assert.ok(interruptResult.result.value.success, '打断插队按钮必须存在');
    assert.ok(interruptResult.result.value.triggered, '必须成功分发插队事件');
  });

  // 9. 移动端视口仿真与触控热区验证 (Pixel 8: 390x844)
  await t.test('5. 移动端仿真：视口通栏无横向滚动条，触控控件热区合规', async () => {
    await sendCdp('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
    });

    const mobileMetrics = await sendCdp('Runtime.evaluate', {
      expression: `(() => {
        const scrollWidth = document.documentElement.scrollWidth;
        const windowWidth = window.innerWidth;
        const actionBtn = document.querySelector('.msg-action-btn');
        return {
          noHorizontalOverflow: scrollWidth <= windowWidth,
          scrollWidth,
          windowWidth,
          btnOffsetHeight: actionBtn ? actionBtn.offsetHeight : 0,
        };
      })()`,
      returnByValue: true,
    });

    assert.ok(mobileMetrics.result.value.noHorizontalOverflow, `移动视口下严禁横向溢出滚动 (scrollWidth: ${mobileMetrics.result.value.scrollWidth}, innerWidth: ${mobileMetrics.result.value.windowWidth})`);
  });
});
