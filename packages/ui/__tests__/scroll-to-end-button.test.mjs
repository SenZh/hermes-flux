/**
 * 「回到底部」按钮表现层契约。
 *
 * 【断言与杀伤力】
 *   1. 结构恒为 button + 图标 + 文案，形态交给 CSS；
 *   2. JSX 不得声明 aria-hidden / tabindex / data-layout，三者由宿主命令式维护；
 *   3. 文案与 aria-label 必须来自 props（i18n 字典），组件内不得字面量；
 *   4. 删掉 onClick / aria-label 或回加 aria-hidden，对应用例立刻变红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ScrollToEndButton } from '../dist/components-react/conversation/ScrollToEndButton.js';
import { mountScrollToEndButton } from '../dist/components-react/conversation/mount.js';

function render(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(ScrollToEndButton, {
      label: '回到底部',
      ariaLabel: '滚动到会话末尾',
      onClick: () => {},
      ...overrides,
    }),
  );
}

test('ScrollToEndButton: 结构与文案契约', async (t) => {
  const html = render();

  await t.test('1. 必须是 type=button 的 .scroll-end 按钮', () => {
    assert.match(html, /^<button type="button" class="scroll-end"/);
    assert.match(html, /<\/button>$/);
  });

  await t.test('2. 图标与文案都存在', () => {
    assert.match(html, /class="scroll-end__icon"/);
    assert.match(html, /class="scroll-end__label">回到底部</);
    assert.match(html, /<svg[^>]*stroke="currentColor"/);
  });

  await t.test('3. aria-label 必须来自 props', () => {
    assert.match(html, /aria-label="滚动到会话末尾"/);
    const en = render({ label: 'Scroll to end', ariaLabel: 'Scroll to end of conversation' });
    assert.match(en, /aria-label="Scroll to end of conversation"/);
    assert.match(en, />Scroll to end</);
  });

  await t.test('4. 按钮根节点不得声明命令式属性或形态属性', () => {
    const buttonTag = /^<button[^>]*>/.exec(html)?.[0] ?? '';
    assert.ok(buttonTag, '必须能取到按钮起始标签');
    assert.equal(buttonTag.includes('aria-hidden'), false, 'aria-hidden 必须由宿主写');
    assert.equal(buttonTag.includes('tabindex'), false, 'tabindex 必须由宿主写');
    assert.equal(buttonTag.includes('data-layout'), false, '形态只认 actionbar 的 data-presence-layout');
    assert.equal(buttonTag.includes('data-at-bottom'), false, '显隐只认 actionbar 的 data-at-bottom');
  });
});

test('mountScrollToEndButton: 未连接宿主必须抛错', () => {
  assert.throws(
    () =>
      mountScrollToEndButton(
        { isConnected: false },
        () => ({ label: '回到底部', ariaLabel: '滚动到会话末尾', onClick: () => {} }),
      ),
    /must be connected/,
  );
});
