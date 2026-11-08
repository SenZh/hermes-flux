import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderInputDock,
  renderQueueTray,
  renderAttachmentTray,
  renderSlashPopper,
  renderMentionPopper,
  renderModelPickerTree,
} from '../../dist/components/InputDock/InputDock.js';

test('InputDock Enhanced - 队列托盘、附件托盘、手风琴模型器与Popper测试', async (t) => {
  await t.test('1. 待发送队列托盘 (renderQueueTray)：多条排队与紧急打断插队按钮', () => {
    const queueItems = [
      { id: 'q1', text: '先帮我写个单测', model: 'claude-3-7-sonnet' },
      { id: 'q2', text: '然后补齐文档' },
    ];
    const html = renderQueueTray(queueItems);

    assert.ok(html.includes('pending-queue-tray'), '必须渲染排队托盘容器');
    assert.ok(html.includes('(2)'), '显示排队数量');
    assert.ok(html.includes('data-action="interrupt-and-push"'), '必须包含打断并执行快捷动作');
    assert.ok(html.includes('#1'), '包含序号 1');
    assert.ok(html.includes('先帮我写个单测'), '包含文本摘要');
    assert.ok(html.includes('data-action="queue-up"'), '包含上移按钮');
    assert.ok(html.includes('data-action="queue-down"'), '包含下移按钮');
    assert.ok(html.includes('data-action="queue-edit"'), '包含编辑按钮');
    assert.ok(html.includes('data-action="queue-cancel"'), '包含取消按钮');

    // 边界：空队列返回空
    assert.equal(renderQueueTray([]), '');
    assert.equal(renderQueueTray(undefined), '');
  });

  await t.test('2. 附件暂存托盘 (renderAttachmentTray)：图片缩略图与移除小叉', () => {
    const attachments = [
      { id: 'att-1', name: 'screenshot.png', type: 'image', previewUrl: 'blob:mock-img' },
      { id: 'att-2', name: 'architecture.pdf', type: 'pdf' },
    ];
    const html = renderAttachmentTray(attachments);

    assert.ok(html.includes('composer-attachment-tray'), '必须渲染附件托盘');
    assert.ok(html.includes('composer-attachment-card'), '必须渲染附件双层缩略图卡片');
    assert.ok(html.includes('Image 1'), '必须自动为第1张图片标注 Image 1 序号');
    assert.ok(html.includes('Doc 1'), '必须自动为第1份文档标注 Doc 1 序号');
    assert.ok(html.includes('src="blob:mock-img"'), '图片附件渲染缩略图');
    assert.ok(html.includes('screenshot.png'), '渲染文件名');
    assert.ok(html.includes('architecture.pdf'), '渲染文档名');
    assert.ok(html.includes('btn-remove-attachment'), '包含移除小叉');

    // 边界：空附件返回空
    assert.equal(renderAttachmentTray([]), '');
  });

  await t.test('3. 斜杠补全面板 (renderSlashPopper)：系统指令与 Skill 标识', () => {
    const items = [
      { name: '/clear', description: '清空会话屏幕' },
      { name: '/code-review', description: '代码架构质量审查', isSkill: true },
    ];

    // open = true
    const openHtml = renderSlashPopper(items, true);
    assert.ok(openHtml.includes('composer-slash-popper'), '展示补全面板');
    assert.ok(openHtml.includes('/clear'), '包含普通命令');
    assert.ok(openHtml.includes('/code-review'), '包含 Skill 命令');
    assert.ok(openHtml.includes('SKILL'), '包含 Skill 徽章标识');

    // open = false
    assert.equal(renderSlashPopper(items, false), '', '关闭时不应输出任何 HTML');
  });

  await t.test('4. @ 智能引用面板 (renderMentionPopper)：文档与 Agent 分流', () => {
    const items = [
      { type: 'file', name: 'packages/core/src/rpc.ts', detail: '42KB' },
      { type: 'agent', name: '架构师王工', detail: '专职架构审查' },
    ];

    const openHtml = renderMentionPopper(items, true);
    assert.ok(openHtml.includes('composer-mention-popper'), '展示引用面板');
    assert.ok(openHtml.includes('packages/core/src/rpc.ts'), '包含文件项');
    assert.ok(openHtml.includes('架构师王工'), '包含 Agent 项');
    assert.ok(openHtml.includes('📄'), '文件图标');
    assert.ok(openHtml.includes('🤖'), 'Agent 图标');

    assert.equal(renderMentionPopper(items, false), '');
  });

  await t.test('5. 模型选择器 Provider 手风琴折叠 (renderModelPickerTree)', () => {
    const props = {
      selectedModel: 'anthropic/claude-3-7-sonnet',
      modelMenuOpen: true,
      reasoningLevel: 'default',
      approvalMode: 'auto',
      isStreaming: false,
      modelDetails: [
        { id: 'anthropic/claude-3-7-sonnet', provider: 'Anthropic', name: 'Claude 3.7 Sonnet', displayName: 'Claude 3.7', contextLength: 200000, supportsVision: true },
        { id: 'openai/gpt-4o', provider: 'OpenAI', name: 'GPT-4o', displayName: 'GPT-4o', contextLength: 128000, supportsVision: true },
      ],
      // 将 OpenAI 设为折叠状态
      collapsedProviders: ['OpenAI'],
    };

    const html = renderModelPickerTree(props);
    assert.ok(html.includes('model-provider-group'), '包含厂商分组');
    assert.ok(html.includes('Anthropic'), '包含 Anthropic 厂商标题');
    assert.ok(html.includes('OpenAI'), '包含 OpenAI 厂商标题');
    assert.ok(html.includes('VISION'), '包含 Vision 多模态微标');
    assert.ok(html.includes('20万'), '包含上下文长度');

    // 验证手风琴折叠状态
    assert.ok(html.includes('display: none;'), '折叠的厂商 items 容器必须为 display: none');
    assert.ok(html.includes('display: block;'), '未折叠的厂商 items 容器必须为 display: block');
  });

  await t.test('6. renderInputDock 宿主装配：集成队列抽屉、附件暂存托盘与黄金限宽', () => {
    const dockHtml = renderInputDock({
      selectedModel: 'anthropic/claude-3-7-sonnet',
      reasoningLevel: 'high',
      approvalMode: 'auto',
      isStreaming: false,
      modelMenuOpen: false,
      attachments: [{ id: 'att-1', name: 'photo.jpg', type: 'image' }],
      queuedMessages: [{ id: 'q-1', text: '排队的消息' }],
    });

    assert.ok(dockHtml.includes('composer-dock'), '必须渲染输入舱容器');
    // 740px 黄金限宽已收敛到 conversation.css 的 .composer-dock（组件只输出语义类名）
    assert.ok(dockHtml.includes('input-card-box composer-dock'), '输入舱必须挂载统一外壳类，由样式表承担 740px 限宽');
    assert.ok(dockHtml.includes('pending-queue-tray'), '宿主必须自动挂载待发送队列抽屉');
    assert.ok(dockHtml.includes('composer-attachment-tray'), '宿主必须自动挂载附件暂存托盘');
    assert.ok(dockHtml.includes('dock-prompt-input'), '必须包含核心输入框');
  });

  await t.test('7. renderInputDock 通知栈 (Notice Stack)：回滚横幅与操作提示统一于输入框上方依次排列，杜绝内嵌与顶端漂移', () => {
    // 场景 A: 仅有回滚横幅
    const rollbackOnlyHtml = renderInputDock({
      selectedModel: 'anthropic/claude-3-7-sonnet',
      reasoningLevel: 'default',
      approvalMode: 'auto',
      isStreaming: false,
      rollbackBanner: { removedCount: 2, anchorLabel: '09:39:17' },
    });
    assert.ok(rollbackOnlyHtml.includes('dock-notice-stack'), '必须包含输入框上方通知栈');
    assert.ok(rollbackOnlyHtml.includes('rollback-pending-banner'), '渲染回滚横幅条');
    assert.ok(rollbackOnlyHtml.includes('data-action="rollback-cancel"'), '包含取消回滚动作');
    assert.ok(rollbackOnlyHtml.indexOf('dock-notice-stack') < rollbackOnlyHtml.indexOf('composer-dock'), '通知栈必须严格位于 composer-dock 输入框上方');

    // 场景 B: 仅有操作提醒（例如“提问已回填至输入框”）
    const noticeOnlyHtml = renderInputDock({
      selectedModel: 'anthropic/claude-3-7-sonnet',
      reasoningLevel: 'default',
      approvalMode: 'auto',
      isStreaming: false,
      notice: '提问已回填至输入框',
    });
    assert.ok(noticeOnlyHtml.includes('dock-notice-stack'), '必须包含输入框上方通知栈');
    assert.ok(noticeOnlyHtml.includes('id="dock-notice"'), '渲染提示条');
    assert.ok(noticeOnlyHtml.includes('提问已回填至输入框'), '包含提示文本');
    assert.ok(noticeOnlyHtml.indexOf('id="dock-notice"') < noticeOnlyHtml.indexOf('composer-dock'), '提示条必须严格位于 composer-dock 输入框上方');
    // 确认 composer-dock 内部不再包含 dock-notice
    const composerIndex = noticeOnlyHtml.indexOf('composer-dock');
    const composerSubstr = noticeOnlyHtml.slice(composerIndex);
    assert.ok(!composerSubstr.includes('id="dock-notice"'), 'composer-dock 输入框卡片内部绝不可再内嵌 dock-notice');

    // 场景 C: 多提醒并存（回滚横幅 + 操作提示）：依次上下排列
    const dualHtml = renderInputDock({
      selectedModel: 'anthropic/claude-3-7-sonnet',
      reasoningLevel: 'default',
      approvalMode: 'auto',
      isStreaming: false,
      notice: '提问已回填至输入框',
      rollbackBanner: { removedCount: 3, anchorLabel: '10:00:00' },
    });
    assert.ok(dualHtml.includes('dock-notice-stack'), '必须包含输入框上方通知栈');
    assert.ok(dualHtml.indexOf('rollback-pending-banner') < dualHtml.indexOf('id="dock-notice"'), '回滚条与提示条在通知栈内依次上下排列');
    assert.ok(dualHtml.indexOf('id="dock-notice"') < dualHtml.indexOf('composer-dock'), '两者均位于输入框上方');
  });
});
