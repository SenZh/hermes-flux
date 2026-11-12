import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeApprovalMode,
  reasoningLevelLabel,
  renderInputDock,
  resolveComposerPrimaryAction,
} from '../dist/components/InputDock/InputDock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const css = fs
  .readFileSync(path.join(repoRoot, 'packages/ui/src/styles/conversation.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const baseProps = {
  selectedModel: 'gemini-3.8-flash',
  models: ['gemini-3.8-flash', 'gpt-5'],
  reasoningLevel: 'high',
  approvalMode: 'smart',
  isStreaming: false,
  disabled: false,
  modelMenuOpen: false,
};

/** 取一个选择器块，断言时只看该规则体。 */
const blockOf = (selector) => {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `必须存在 ${selector} 样式块`);
  return match[1];
};

test('Composer dock - 输入舱语义与几何', async (t) => {
  await t.test('1. 外壳走内陷输入面 + 1px 发丝边 + 12px 圆角 + 零投影', () => {
    const shell = blockOf('.input-card-box.composer-dock');
    assert.ok(shell.includes('background: var(--input)'), '输入舱必须用内陷输入面，而不是再铺一张卡片');
    assert.ok(shell.includes('border: 1px solid var(--border)'), '外壳是一条语义发丝线');
    assert.ok(shell.includes('border-radius: var(--radius-window)'), '圆角与对话区同源');
    assert.ok(shell.includes('box-shadow: none'), '输入舱禁止投影');
    assert.ok(shell.includes('max-width: 740px'), '黄金限宽 740px 必须保留');
  });

  await t.test('2. 聚焦不描边、不叠外环', () => {
    const focus = blockOf('.input-card-box.composer-dock:focus-within');
    assert.ok(focus.includes('border-color: var(--border)'), '聚焦不得改变边框色');
    assert.ok(focus.includes('box-shadow: none'), '聚焦不得叠外环');
    assert.ok(!focus.includes('0 0 0 1px'), '禁止回退到旧的外圈环');
  });

  await t.test('3. footer 无分割线、控件无药丸底', () => {
    const footer = blockOf('.composer-dock__footer');
    assert.ok(!footer.includes('border-top'), 'footer 严禁画分割线');
    assert.ok(!footer.includes('background'), 'footer 必须透明');

    const ctrl = blockOf('.composer-ctrl');
    assert.ok(ctrl.includes('border: none'), '模型控件不得有描边');
    assert.ok(ctrl.includes('background: transparent'), '模型控件不得有底色');
  });

  await t.test('4. 发送与停止是同一套纯图标命中区', () => {
    const sharedMatch = css.match(/\.composer-icon-btn,\s*\.composer-send,\s*\.composer-stop\s*\{([\s\S]*?)\}/);
    assert.ok(sharedMatch, '三个图标控件必须共用一条基础规则');
    const shared = sharedMatch[1];
    assert.ok(shared.includes('width: 28px') && shared.includes('height: 28px'), '命中区统一 28px');
    assert.ok(shared.includes('border: none'), '按钮不得有边框');
    assert.ok(shared.includes('background: transparent'), '按钮不得有底色');

    const disabled = blockOf('.composer-send:disabled');
    assert.ok(disabled.includes('color: var(--faint)'), '空内容时只把图标降到 faint');

    const block = blockOf('.composer-stop__block');
    assert.ok(block.includes('width: 10px') && block.includes('height: 10px'), '停止是 10px 实心方块');
    assert.ok(block.includes('animation: composer-stop-breath'), '停止方块带呼吸动效');
  });

  await t.test('5. 输入区 44px 起步，触顶 220px 后内部滚动', () => {
    const editor = blockOf('.composer-dock__textarea');
    assert.ok(editor.includes('min-height: 44px'), '单行高度必须从 44px 起步');
    assert.ok(editor.includes('max-height: 220px'), '上限必须是 220px');
    assert.ok(editor.includes('overflow-y: auto'), '触顶后交给内部滚动');
    assert.ok(editor.includes('resize: none'), '禁止浏览器原生拖拽手柄');
    assert.ok(editor.includes('font-size: var(--chat-text-markdown)'), '字号跟随设置档位');
    assert.ok(!editor.includes('transition'), '高度不得做过渡');
  });
});

test('Composer dock - 渲染产物与状态机', async (t) => {
  await t.test('1. 附件轨在输入舱外部上方，且不再有收起按钮', () => {
    const html = renderInputDock({
      ...baseProps,
      attachments: [{ id: 'a1', name: 'shot.png', type: 'image', previewUrl: 'data:image/png;base64,AA' }],
    });
    assert.ok(html.includes('composer-attach-rail'), '必须渲染附件轨');
    assert.ok(
      html.indexOf('composer-attach-rail') < html.indexOf('input-card-box composer-dock'),
      '附件轨必须位于输入舱外壳之前（外部上方）',
    );
    assert.ok(!html.includes('dock-input-collapse-toggle'), '收起按钮必须彻底移除');
  });

  await t.test('2. 模型触发控件显示「模型名 / 思考等级」且无方框', () => {
    const html = renderInputDock(baseProps);
    assert.ok(html.includes('composer-ctrl__label'), '模型名必须有独立节点');
    assert.ok(html.includes('composer-ctrl__sep'), '模型名与等级之间必须有分隔符');
    assert.ok(html.includes('composer-ctrl__level'), '思考等级必须常驻显示');
    assert.ok(html.includes('Gemini 3.8 Flash'), '模型名走可读名，不是裸 ID');
  });

  await t.test('3. 空闲态只发发送，运行态只发停止，且停止不写文字', () => {
    const idle = renderInputDock(baseProps);
    assert.ok(idle.includes('id="dock-send-btn"'), '空闲态主按钮是发送');
    assert.ok(!idle.includes('id="dock-stop-btn"'), '空闲态不应出现停止');

    const running = renderInputDock({ ...baseProps, isStreaming: true });
    assert.ok(running.includes('id="dock-stop-btn"'), '运行态主按钮是停止');
    assert.ok(!running.includes('id="dock-send-btn"'), '运行态不应残留发送按钮');
    assert.match(running, /aria-label="停止当前回合"/, '停止按钮只保留可访问名');
    assert.ok(!/id="dock-stop-btn"[^>]*>\s*停止/.test(running), '停止按钮内不得出现中文可见文字');
  });

  await t.test('4. 审批三态渲染完整，当前项只有一枚勾选', () => {
    const html = renderInputDock(baseProps);
    assert.equal((html.match(/data-mode="/g) || []).length, 3, '必须渲染三个审批选项');
    // 只统计审批菜单片段：思考级联也有 aria-checked，不能混算。
    const menu = html.slice(html.indexOf('id="dock-approval-dropdown"'), html.indexOf('id="dock-model-selector-btn"'));
    assert.equal((menu.match(/aria-checked="true"/g) || []).length, 1, '只能有一个当前项');
    assert.ok(html.includes('data-mode="manual"'), '手动模式入口');
    assert.ok(html.includes('data-mode="off"'), '免审批入口');
  });

  await t.test('5. 运行态：无草稿只有停止，有草稿时入队按钮叠在停止上方', () => {
    const noDraft = renderInputDock({ ...baseProps, isStreaming: true, hasDraft: false });
    assert.ok(noDraft.includes('id="dock-stop-btn"'), '运行态必须有停止按钮');
    assert.ok(
      /id="dock-queue-btn"[^>]*\shidden[\s>]/.test(noDraft),
      '无草稿时入队按钮必须带 hidden，不占位',
    );

    const withDraft = renderInputDock({ ...baseProps, isStreaming: true, hasDraft: true });
    assert.ok(
      withDraft.indexOf('dock-queue-btn') < withDraft.indexOf('dock-stop-btn'),
      '入队按钮必须排在停止按钮之前（上下排列时在上）',
    );
    assert.ok(!/id="dock-queue-btn"[^>]*\shidden[\s>]/.test(withDraft), '有草稿时入队按钮必须可见');
  });

  await t.test('6. 禁用态与占位文案走 i18n 字典', () => {
    const enabledHtml = renderInputDock(baseProps);
    const disabledHtml = renderInputDock({ ...baseProps, disabled: true });
    assert.ok(disabledHtml.includes('data-locked="true"'), '网关未连接时发送按钮必须锁定');
    assert.ok(enabledHtml.includes('规划、构建或提问。 @ 提及，/ 命令'), '占位必须取自 dock.placeholder');
    assert.ok(disabledHtml.includes('正在连接网关...'), '禁用态占位必须取自 dock.placeholderDisabled');
  });
});

test('Composer dock - 纯函数状态机', async (t) => {
  await t.test('主按钮只由回合相位决定', () => {
    assert.equal(resolveComposerPrimaryAction('idle'), 'send');
    assert.equal(resolveComposerPrimaryAction('running'), 'stop');
  });

  await t.test('审批别名归一且未知值落到智能', () => {
    assert.equal(normalizeApprovalMode('manual'), 'manual');
    assert.equal(normalizeApprovalMode('sandbox'), 'manual');
    assert.equal(normalizeApprovalMode('auto'), 'off');
    assert.equal(normalizeApprovalMode('ask'), 'smart');
    assert.equal(normalizeApprovalMode(undefined), 'smart');
    assert.equal(normalizeApprovalMode('nonsense'), 'smart');
  });

  await t.test('思考等级五档文案唯一', () => {
    assert.equal(reasoningLevelLabel('default'), '默认');
    assert.equal(reasoningLevelLabel('off'), '关');
    assert.equal(reasoningLevelLabel('medium'), '高');
    assert.equal(reasoningLevelLabel('max'), '最高');
  });
});
