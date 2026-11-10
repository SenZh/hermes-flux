/**
 * 提示词导航轨渲染契约（服务端静态渲染，可落盘）。
 *
 * 断言口径：
 *   1. 断言真实产出的 DOM 字符串，不 mock 组件；
 *   2. 覆盖「有轨道 / 不足两条 / 空表」三态，防止组件在空数据上抛错；
 *   3. 宿主 host 必须出现在中间舱骨架里，且位于滚动容器之后。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PromptNavigatorRail } from '../dist/components-react/conversation/PromptNavigatorRail.js';
import { renderMiddlePod } from '../dist/components/MiddlePod/MiddlePod.js';

const prompts = [
  { id: 'u1', index: 0, preview: '第一问' },
  { id: 'u2', index: 2, preview: '第二问' },
  { id: 'u3', index: 4, preview: '第三问' },
];

function renderRail(entries, activeIndex) {
  return renderToStaticMarkup(
    createElement(PromptNavigatorRail, {
      snapshot: { prompts: entries, activeIndex },
      actions: { onSelect: () => {} },
    })
  );
}

test('三条提问渲染三根 tick，当前项带 aria-current', () => {
  const html = renderRail(prompts, 2);
  const ticks = html.match(/role="option"/g) ?? [];
  assert.equal(ticks.length, 3, '每条提问恰好一根 tick');
  assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1, '当前项唯一');
  assert.match(html, /role="listbox"/);
  assert.match(html, /aria-activedescendant|aria-label=/);
  assert.match(html, /conv-prompt-rail__tick-bar/);
});

test('不足两条提问不渲染轨道', () => {
  assert.equal(renderRail([], -1), '');
  assert.equal(renderRail([prompts[0]], 0), '');
});

test('当前项越界时按末条处理，且不抛错', () => {
  const html = renderRail(prompts, 999);
  assert.equal((html.match(/role="option"/g) ?? []).length, 3);
  assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1);
});

test('中间舱骨架输出导航轨 host，且位于滚动容器之后', () => {
  const html = renderMiddlePod({
    gatewayConnected: true,
    messages: [
      { id: 'u1', role: 'user', content: '第一问', timestamp: '2026-11-10T00:00:00Z' },
      { id: 'a1', role: 'assistant', content: '答复', timestamp: '2026-11-10T00:00:01Z' },
      { id: 'u2', role: 'user', content: '第二问', timestamp: '2026-11-10T00:00:02Z' },
    ],
    dockHtml: '',
  });
  const streamAt = html.indexOf('id="conversation-stream"');
  const hostAt = html.indexOf('id="react-prompt-navigator-host"');
  assert.ok(streamAt >= 0, '滚动容器必须存在');
  assert.ok(hostAt > streamAt, 'host 必须挂在滚动容器之后，绝不能进流');
});
