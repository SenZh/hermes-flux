import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderBotProfileCard,
  renderGroupRoomView,
  renderGroupPromotionDialog,
  renderProjectTreeViewer,
  renderBtwCapsule,
} from '../../dist/index.js';

// 合法 CSS Token 集合校验
const validCssTokens = new Set([
  '--bg-window',
  '--bg-rail',
  '--bg-panel',
  '--bg-card',
  '--bg-card-hover',
  '--bg-card-active',
  '--bg-elevated',
  '--bg-input',
  '--bg-code',
  '--bg-backdrop',
  '--accent',
  '--accent-hover',
  '--accent-dim',
  '--accent-glow',
  '--accent-subtle',
  '--accent-border',
  '--accent-text',
  '--text-main',
  '--text-secondary',
  '--text-muted',
  '--text-faint',
  '--border-subtle',
  '--border-medium',
  '--border-strong',
  '--specular-line',
  '--shadow-window',
  '--shadow-card',
  '--shadow-dock',
  '--jade-pulse',
  '--jade-glow',
]);

function assertAllVarsAreValid(html, componentName) {
  const varMatches = [...html.matchAll(/var\((--[a-zA-Z0-9-]+)[^)]*\)/g)];
  for (const match of varMatches) {
    const token = match[1];
    assert.ok(
      validCssTokens.has(token),
      `[${componentName}] 发现了未在主题系统注册的幽灵 CSS 变量: ${token}`
    );
  }
}

function assertNoHardcodedColors(html, componentName) {
  const coloredHexMatch = html.match(/#[0-9a-fA-F]{3,8}/g);
  assert.equal(coloredHexMatch, null, `[${componentName}] 严禁包含硬编码十六进制色值`);
}

test('Advanced UI Components - Bot, Group, Project & BTW Capsule', async (t) => {
  await t.test('1. BotProfileCard：渲染专职 Bot 档案、终生主工位入口与触控热区', () => {
    const html = renderBotProfileCard({
      profile: {
        name: 'arch-wang',
        displayName: '架构老王',
        description: '负责系统架构、分层治理与高并发设计',
        tools: ['bash', 'read_file', 'edit_file'],
      },
      foreverChatSessionId: 'sess-bot-forever-chat',
    });

    assert.ok(html.includes('data-bot-profile="arch-wang"'));
    assert.ok(html.includes('架构老王'));
    assert.ok(html.includes('@arch-wang'));
    assert.ok(html.includes('3 个专属工具'));
    assert.ok(html.includes('bot-btn-enter-forever-chat'));
    assert.ok(html.includes('min-height: 44px;'), '按钮触控热区必须 >= 44pt/48dp');

    assertNoHardcodedColors(html, 'BotProfileCard');
    assertAllVarsAreValid(html, 'BotProfileCard');
  });

  await t.test('2. GroupRoomView：渲染多智能体群聊会议室、种子备忘录与安全区', () => {
    const html = renderGroupRoomView({
      room: {
        roomId: 'grp-room-101',
        name: 'OAuth死锁研讨会议室',
        members: ['arch-wang', 'fe-zhang', 'default'],
        createdAt: 1000,
        updatedAt: 1000,
      },
      entries: [
        {
          messageId: 'seed-1',
          seq: 1,
          senderProfile: 'system',
          timestamp: 1000,
          text: '会议种子背景摘要：请重点排查 FSM 锁死。',
          isSeed: true,
        },
        {
          messageId: 'msg-2',
          seq: 2,
          senderProfile: 'arch-wang',
          timestamp: 1001,
          text: '我已验证读写锁时序，问题在重入死锁。',
        },
      ],
    });

    assert.ok(html.includes('data-room-id="grp-room-101"'));
    assert.ok(html.includes('OAuth死锁研讨会议室'));
    assert.ok(html.includes('3 位专家研讨'));
    assert.ok(html.includes('group-seed-memo-card'));
    assert.ok(html.includes('会议种子背景备忘录'));
    assert.ok(html.includes('@arch-wang'));
    assert.ok(html.includes('env(safe-area-inset-bottom)'), '底部发言舱必须适配安全区');
    assert.ok(html.includes('min-height: 44px;'), '发言输入与发送必须 >= 44pt/48dp');

    assertNoHardcodedColors(html, 'GroupRoomView');
    assertAllVarsAreValid(html, 'GroupRoomView');
  });

  await t.test('3. GroupPromotionDialog：四阶拉群弹窗、议题输入与多选勾选单', () => {
    const html = renderGroupPromotionDialog({
      parentSessionId: 'sess-parent-88',
      defaultTopic: 'OAuth死锁协同研讨群',
      availableProfiles: [
        { name: 'default', displayName: '主中枢助理' },
        { name: 'arch-wang', displayName: '架构老王' },
        { name: 'fe-zhang', displayName: '前端小张' },
      ],
    });

    assert.ok(html.includes('data-parent-session-id="sess-parent-88"'));
    assert.ok(html.includes('发起多智能体研讨会议'));
    assert.ok(html.includes('OAuth死锁协同研讨群'));
    assert.ok(html.includes('架构老王'));
    assert.ok(html.includes('前端小张'));
    assert.ok(html.includes('group-dialog-btn-confirm'));
    assert.ok(html.includes('min-height: 44px;'), '弹窗按钮必须 >= 44pt/48dp');

    assertNoHardcodedColors(html, 'GroupPromotionDialog');
    assertAllVarsAreValid(html, 'GroupPromotionDialog');
  });

  await t.test('4. ProjectTreeViewer：工作区目录树递归节点与主工作区标识', () => {
    const html = renderProjectTreeViewer({
      tree: [
        {
          name: 'packages',
          path: '/packages',
          isDirectory: true,
          children: [
            { name: 'core', path: '/packages/core', isDirectory: true, children: [] },
            { name: 'ui', path: '/packages/ui', isDirectory: true, children: [] },
          ],
        },
        { name: 'README.md', path: '/README.md', isDirectory: false, size: 2048 },
      ],
      primaryPath: '/projects/hermes-flux',
    });

    assert.ok(html.includes('工作区文件目录树'));
    assert.ok(html.includes('/projects/hermes-flux'));
    assert.ok(html.includes('packages'));
    assert.ok(html.includes('README.md'));
    assert.ok(html.includes('2048B'));

    assertNoHardcodedColors(html, 'ProjectTreeViewer');
    assertAllVarsAreValid(html, 'ProjectTreeViewer');
  });

  await t.test('5. BtwCapsule：只读外援咨询胶囊与零上下文污染标识', () => {
    const html = renderBtwCapsule({
      targetProfile: 'arch-wang',
      response: '建议使用 CAS 原子操作替代互斥重量级锁。',
      tokenCount: 28,
    });

    assert.ok(html.includes('data-target-profile="arch-wang"'));
    assert.ok(html.includes('外援咨询胶囊'));
    assert.ok(html.includes('@arch-wang'));
    assert.ok(html.includes('只读外援 · 零上下文污染'));
    assert.ok(html.includes('建议使用 CAS 原子操作'));
    assert.ok(html.includes('28 tokens'));
    assert.ok(html.includes('btw-btn-quote'));
    assert.ok(html.includes('min-height: 44px;'), '引用按钮触控热区必须 >= 44pt/48dp');

    assertNoHardcodedColors(html, 'BtwCapsule');
    assertAllVarsAreValid(html, 'BtwCapsule');
  });
});
