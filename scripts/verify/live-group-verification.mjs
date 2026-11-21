/**
 * 真实网关群聊页面物理行为验证脚本 (scripts/verify/live-group-verification.mjs)
 *
 * 【设计意图 (Why)】
 *   按用户要求，在真实 Blink 浏览器内核中加载真实打包的生产页面，
 *   连接真实网关，在真实工作台页面上执行：
 *   1. 选中群聊研讨室会话；
 *   2. 输入并发送消息；
 *   3. 强断言：群聊消息严格呈现在群聊视口中，绝不逃逸至普通会话，绝不新建会话，activeSessionId 保持为空；
 *   4. 通过 CDP 截取高清渲染截图存盘。
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchLiveApp, liveGatewayEnvReady, findBrowser } from '../../packages/desktop/__tests__/e2e/browser-harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('[Live Verify] 检查运行环境与真实网关凭据...');
  if (!findBrowser()) {
    console.error('[Live Verify] 错误: 未检测到 Edge 或 Chrome 浏览器');
    process.exit(1);
  }
  if (!liveGatewayEnvReady()) {
    console.error('[Live Verify] 错误: 未配置 FLUX_GATEWAY_URL / FLUX_GATEWAY_USER / FLUX_GATEWAY_PASS');
    process.exit(1);
  }

  const rootDir = path.resolve('.');
  const artifactsDir = path.join(rootDir, 'artifacts/verification');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  console.log('[Live Verify] 启动浏览器并加载 Hermes Flux 生产渲染层，接入真实网关...');
  const app = await launchLiveApp({ rootDir });

  try {
    console.log('[Live Verify] 等待网关 WebSocket 握手就绪与三域初始数据上屏...');
    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      try {
        const stateInfo = await app.evaluate(`(() => {
          return {
            hasState: Boolean(window.__fluxState),
            connected: window.__fluxState?.gatewayConnected,
            connecting: window.__fluxState?.gatewayConnecting,
            dockNotice: window.__fluxState?.dockNotice,
            profilesPhase: window.__fluxState?.profilesPhase,
            gatewayUrl: window.__fluxState?.gatewayUrl,
          };
        })()`);
        console.log(`[Live Verify 轮询 ${i+1}s] 页面状态:`, JSON.stringify(stateInfo));
        if (app.pageErrors.length > 0) {
          console.log(`[Live Verify 页面报错]:`, app.pageErrors.slice(-3));
        }
        if (stateInfo.connected) break;
      } catch (e) {
        console.log(`[Live Verify 轮询 ${i+1}s] eval 暂不可用:`, e.message);
      }
    }
    await app.waitUntilReady();
    console.log('[Live Verify] 网关已成功连接！');

    // 等待群聊列表与初始会话列表全部加载就绪
    console.log('[Live Verify] 等待群聊房间列表与会话列表全部加载就绪...');
    await app.waitFor(
      `Boolean(window.__fluxState && window.__fluxState.groupRooms && window.__fluxState.groupRooms.length > 0 && window.__fluxState.sessions && window.__fluxState.sessions.length > 0)`,
      { label: 'groupRooms and sessions loaded', timeoutMs: 30000 }
    );

    // 记录初始状态基线
    const baseline = await app.evaluate(`(() => {
      const state = window.__fluxState;
      return {
        sessionCount: state.sessions.length,
        sessionIds: state.sessions.map(s => s.id),
        groupRooms: state.groupRooms.map(r => ({ roomId: r.roomId, name: r.name })),
        activeSessionId: state.activeSessionId,
        activeFocus: state.activeFocus,
      };
    })()`);

    console.log(`[Live Verify] 初始会话基线: 会话数=${baseline.sessionCount}, 群聊数=${baseline.groupRooms.length}`);
    const targetRoom = baseline.groupRooms[0];
    console.log(`[Live Verify] 选取目标群聊研讨室: [${targetRoom.name}] (roomId: ${targetRoom.roomId})`);

    // 1. 在页面上点击该群聊房间
    console.log('[Live Verify] 点击左轨群聊条目...');
    const clicked = await app.evaluate(`(() => {
      const el = document.querySelector('.rail-group-item[data-room-id="${targetRoom.roomId}"]');
      if (el) {
        el.click();
        return true;
      }
      return false;
    })()`);
    assert.equal(clicked, true, `必须在 DOM 中找到并点击群聊条目 .rail-group-item[data-room-id="${targetRoom.roomId}"]`);

    // 2. 等待群聊视口切换完毕
    console.log('[Live Verify] 等待群聊视口激活与日志加载...');
    await app.waitFor(
      `window.__fluxState.activeFocus.type === 'group' && window.__fluxState.activeFocus.roomId === '${targetRoom.roomId}' && window.__fluxState.messagesPhase === 'ready'`,
      { label: 'group room viewport ready', timeoutMs: 25000 }
    );

    const afterSelectState = await app.evaluate(`(() => {
      const state = window.__fluxState;
      return {
        activeFocus: state.activeFocus,
        activeSessionId: state.activeSessionId,
        activeLiveSessionId: state.activeLiveSessionId,
        messagesCount: state.messages.length,
        messagesPhase: state.messagesPhase,
      };
    })()`);

    console.log('[Live Verify] 群聊视口状态核对:', JSON.stringify(afterSelectState));
    assert.equal(afterSelectState.activeFocus.type, 'group', '当前焦点必须为 group');
    assert.equal(afterSelectState.activeFocus.roomId, targetRoom.roomId, '当前群聊房间 ID 必须匹配');
    assert.equal(afterSelectState.activeSessionId, '', '群聊视口下 activeSessionId 必须严格为空串（物理正交铁律）');
    assert.equal(afterSelectState.activeLiveSessionId, '', '群聊视口下 activeLiveSessionId 必须严格为空串');
    assert.equal(afterSelectState.messagesPhase, 'ready', '群聊记录必须处于 ready 相位');

    // 3. 在输入舱输入消息并发送
    const timestampTag = Date.now();
    const testText = `[Flux Live E2E ${timestampTag}] 自动化真实网关测试：验证群聊发送零逃逸与视口即时呈现`;
    console.log(`[Live Verify] 向输入舱输入消息并点击发送: "${testText}"...`);

    await app.evaluate(`(() => {
      const input = document.getElementById('dock-prompt-input');
      input.value = ${JSON.stringify(testText)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const btn = document.getElementById('dock-send-btn');
      btn.click();
    })()`);

    // 4. 等待群聊视口内渲染出该消息
    console.log('[Live Verify] 等待消息在群聊对话流 (#conversation-stream) 中呈现...');
    const messageRendered = await app.waitFor(`(() => {
      const state = window.__fluxState;
      const msgs = state.messages || [];
      const hasStateMsg = msgs.some(m => m.content && m.content.includes('${timestampTag}'));
      const stream = document.getElementById('conversation-stream');
      const hasDomMsg = stream && stream.innerText && stream.innerText.includes('${timestampTag}');
      if (hasStateMsg || hasDomMsg) {
        return { hasStateMsg, hasDomMsg, msgCount: msgs.length };
      }
      return null;
    })()`, { label: 'message rendered in group stream', timeoutMs: 20000 });

    console.log('[Live Verify] 消息已在群聊视口中呈现:', JSON.stringify(messageRendered));

    // 稍等 1 秒确保状态收敛
    await sleep(1000);

    // 5. 核心验证：对账普通会话列表，断言绝未新建会话，绝未污染普通会话
    console.log('[Live Verify] 核心对账：验证普通会话列表与焦点状态...');
    const finalAudit = await app.evaluate(`(() => {
      const state = window.__fluxState;
      return {
        sessionCount: state.sessions.length,
        sessionIds: state.sessions.map(s => s.id),
        activeSessionId: state.activeSessionId,
        activeLiveSessionId: state.activeLiveSessionId,
        activeFocus: state.activeFocus,
        dockNotice: state.dockNotice,
        lastGroupMessage: state.messages[state.messages.length - 1],
      };
    })()`);

    console.log(`[Live Verify] 对账结果: 会话总数 初始=${baseline.sessionCount} 当前=${finalAudit.sessionCount}`);
    assert.equal(
      finalAudit.sessionCount,
      baseline.sessionCount,
      `致命缺陷拦截失败！群聊发送导致普通会话数增加！(初始=${baseline.sessionCount}, 当前=${finalAudit.sessionCount})`
    );
    assert.deepEqual(
      finalAudit.sessionIds,
      baseline.sessionIds,
      '普通会话列表 ID 集合必须完全保持不变，绝不允许生成新的普通会话！'
    );
    assert.equal(finalAudit.activeSessionId, '', '发送后 activeSessionId 必须保持为空');
    assert.equal(finalAudit.activeFocus.type, 'group', '发送后 activeFocus.type 必须保持为 group');
    assert.equal(finalAudit.activeFocus.roomId, targetRoom.roomId, '发送后 activeFocus.roomId 必须保持匹配');

    // 6. 捕获真实 Blink 浏览器页面截图存盘
    const screenshotPath = path.join(artifactsDir, 'live-group-chat-verified.png');
    console.log(`[Live Verify] 截取真实 Blink 物理渲染全屏截图并存盘至 ${screenshotPath}...`);
    const screenshotRes = await app.cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(screenshotPath, Buffer.from(screenshotRes.data, 'base64'));

    console.log('[Live Verify] 验证圆满成功！所有不变量与物理表现 100% 达标！');
    return { ok: true, screenshotPath, targetRoom: targetRoom.name };
  } finally {
    console.log('[Live Verify] 关闭浏览器并清理测试沙箱...');
    await app.close();
  }
}

main().catch((err) => {
  console.error('[Live Verify] 测试失败:', err);
  process.exit(1);
});
