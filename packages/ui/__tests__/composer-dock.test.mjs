import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderInputDock } from '../dist/components/InputDock/InputDock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const css = fs
  .readFileSync(path.join(repoRoot, 'packages/ui/src/styles/conversation.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const baseProps = {
  selectedModel: 'gemini-3.8-flash',
  models: ['gemini-3.8-flash', 'gpt-5'],
  reasoningLevel: 'high',
  approvalMode: 'auto',
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

test('Composer dock - 输入舱视觉 100% 对标 OpenChamber', async (t) => {
  await t.test('1. 外壳：1px 中性发丝边 + 12px 圆角 + 零投影', () => {
    const shell = blockOf('.input-card-box.composer-dock');
    assert.ok(
      shell.includes('border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent)'),
      '外壳必须是一条中性前景色发丝线，禁止用边框色块'
    );
    assert.ok(shell.includes('border-radius: var(--radius-window)'), '圆角必须与对话区同源（12px）');
    assert.ok(shell.includes('box-shadow: none'), '输入舱禁止投影，避免浮出纸面');
    assert.ok(shell.includes('max-width: 740px'), '黄金限宽 740px 必须保留');
  });

  await t.test('2. footer 不再有分割线，控件不使用药丸底色', () => {
    const footer = blockOf('.composer-dock__footer');
    assert.ok(!footer.includes('border-top'), 'footer 严禁再画 1px 分割线');
    assert.ok(!footer.includes('background'), 'footer 必须透明，与编辑器同面');

    const ctrl = blockOf('.composer-ctrl');
    assert.ok(ctrl.includes('border: none'), '模型 / 思考控件不得有描边');
    assert.ok(ctrl.includes('background: transparent'), '模型 / 思考控件不得有底色');
  });

  await t.test('3. 发送是纯图标按钮，禁用只降不透明度', () => {
    const send = blockOf('.composer-send');
    assert.ok(send.includes('border: none'), '发送按钮不得有边框');
    assert.ok(send.includes('background: transparent'), '发送按钮不得有底色');

    const disabled = blockOf('.composer-send:disabled');
    assert.ok(disabled.includes('opacity: 0.3'), '空内容时只降到 30% 不透明度');
    assert.ok(disabled.includes('cursor: not-allowed'));
  });

  await t.test('4. 编辑器字号跟随设置档位，且不再硬编码 13.5px', () => {
    const editor = blockOf('.composer-dock__textarea');
    assert.ok(editor.includes('font-size: var(--chat-text-markdown)'), '输入文字必须与正文同源缩放');
    assert.ok(!editor.includes('13.5px'), '禁止写死字号');
    assert.ok(editor.includes('resize: none'), '禁止出现浏览器原生拖拽手柄');
  });

  await t.test('5. 渲染产物：语义类名齐全且不残留旧药丸 / 蓝框发送按钮', () => {
    const html = renderInputDock(baseProps);
    assert.ok(html.includes('composer-dock__editor'), '必须渲染编辑器区');
    assert.ok(html.includes('composer-dock__textarea'), 'textarea 必须挂载专用类');
    assert.ok(html.includes('composer-dock__footer'), '必须渲染 footer 行');
    assert.ok(html.includes('composer-ctrl'), '模型 / 思考必须是纯文本控件');
    assert.ok(html.includes('composer-icon-btn'), '附件必须是纯图标按钮');
    assert.ok(html.includes('composer-send'), '发送必须是纯图标按钮');

    assert.ok(!html.includes('micro-pill'), '禁止回退成药丸控件');
    assert.ok(!html.includes('send-action-btn'), '禁止回退成旧蓝框发送按钮');
    assert.ok(!html.includes('input-control-strip'), '禁止回退成带分割线的控制条');
    assert.ok(!html.includes('rgba(56, 189, 248'), '禁止残留硬编码天青色');
    // 只看 footer 的壳层片段（到模型按钮为止）：模型下拉菜单内部仍可以有分隔线
    const footerHtml = html.slice(html.indexOf('composer-dock__footer'), html.indexOf('dock-model-selector-btn'));
    assert.ok(!footerHtml.includes('border-top'), '输入舱 footer 不得再画分割线');
  });

  await t.test('6. 禁用态与占位文案走 i18n 字典', () => {
    const enabledHtml = renderInputDock(baseProps);
    const disabledHtml = renderInputDock({ ...baseProps, disabled: true });
    assert.ok(disabledHtml.includes('data-locked="true"'), '网关未连接时发送按钮必须锁定');
    // 文案来自 zh 字典，说明模板走的是 t() 而不是硬编码字符串
    assert.ok(enabledHtml.includes('给 Hermes 下达任务...'), '可用态占位必须取自 dock.placeholder');
    assert.ok(disabledHtml.includes('正在连接网关...'), '禁用态占位必须取自 dock.placeholderDisabled');
  });
});
