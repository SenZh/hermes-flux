/**
 * 代码块复制按钮行为与回归拦截测试
 *
 * 【设计意图 (Why)】
 *   验证 MarkdownBlock 渲染与点击委托、主/降级剪贴板通道、防空防错边界与定时器恢复，
 *   确保通过 Stryker 高标准变异测试。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownBlock } from '../dist/components-react/conversation/MarkdownBlock.js';
import { copyTextToClipboard, handleCodeBlockCopyClick } from '../dist/lib/codeCopy.js';
import { setLocale } from '../dist/i18n/index.js';

function withGlobals(overrides, fn) {
  const saved = new Map();
  for (const [key, val] of Object.entries(overrides)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: val, configurable: true, writable: true });
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, desc] of saved.entries()) {
        if (desc) Object.defineProperty(globalThis, key, desc);
        else delete globalThis[key];
      }
    });
}

function makeButton({ codeText = 'const x = 1;', preText = 'copy const x = 1;', hasCode = true, hasPre = true, hasWrapper = true } = {}) {
  const wrapper = hasWrapper ? {
    querySelector(selector) {
      if (selector === 'pre > code') return hasCode ? { textContent: codeText } : null;
      if (selector === 'pre') return hasPre ? { textContent: preText } : null;
      return null;
    },
  } : null;

  const button = {
    textContent: '复制',
    dataset: {},
    closest(selector) {
      if (selector === 'button[data-md-copy="true"]') return button;
      if (selector === '.md-codeblock') return wrapper;
      return null;
    },
  };
  return button;
}

test('MarkdownBlock 必须渲染复制按钮并挂载 onClick 委托', () => {
  const html = renderToStaticMarkup(React.createElement(MarkdownBlock, { content: '```ts\nconst a = 1;\n```' }));
  assert.ok(html.includes('data-md-copy="true"'));
  assert.ok(html.includes('md-codeblock'));

  const compiledJs = fs.readFileSync(
    path.resolve(import.meta.dirname, '../dist/components-react/conversation/MarkdownBlock.js'),
    'utf8'
  );
  const onClickCount = (compiledJs.match(/onClick:\s*handleMarkdownClick/g) || []).length;
  assert.equal(onClickCount, 2);
});

test('copyTextToClipboard: 空串直返 false；主通道优先；降级走完整 textarea + execCommand 流程', async () => {
  let clipCalls = 0;
  await withGlobals({
    navigator: { clipboard: { writeText: async () => { clipCalls += 1; } } },
  }, async () => {
    assert.equal(await copyTextToClipboard(''), false);
    assert.equal(clipCalls, 0);

    let copied = '';
    await withGlobals({
      navigator: { clipboard: { writeText: async (t) => { copied = t; } } },
    }, async () => {
      assert.equal(await copyTextToClipboard('primary-text'), true);
      assert.equal(copied, 'primary-text');
    });
  });

  // 主通道抛错 -> 降级 execCommand，验证 textarea 所有关键属性与 DOM 清理
  const ops = [];
  const fakeTextarea = {
    value: '',
    style: {},
    focus: () => ops.push('focus'),
    select: () => ops.push('select'),
  };
  let createdTag = '';
  let execCmd = '';
  const fakeDoc = {
    createElement: (tag) => { createdTag = tag; return fakeTextarea; },
    body: {
      appendChild: (el) => ops.push(['append', el]),
      removeChild: (el) => ops.push(['remove', el]),
    },
    execCommand: (cmd) => { execCmd = cmd; return true; },
  };
  await withGlobals({
    navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } },
    document: fakeDoc,
  }, async () => {
    assert.equal(await copyTextToClipboard('fallback-text'), true);
    assert.equal(createdTag, 'textarea');
    assert.equal(fakeTextarea.value, 'fallback-text');
    assert.equal(fakeTextarea.style.position, 'fixed');
    assert.equal(fakeTextarea.style.left, '-9999px');
    assert.equal(fakeTextarea.style.top, '-9999px');
    assert.equal(execCmd, 'copy');
    assert.deepEqual(ops, [
      ['append', fakeTextarea],
      'focus',
      'select',
      ['remove', fakeTextarea],
    ]);
  });

  // execCommand 返回 false 或抛错、或无 document
  await withGlobals({
    navigator: undefined,
    document: { ...fakeDoc, execCommand: () => false },
  }, async () => {
    assert.equal(await copyTextToClipboard('x'), false);
  });
  await withGlobals({
    navigator: undefined,
    document: { ...fakeDoc, execCommand: () => { throw new Error('boom'); } },
  }, async () => {
    assert.equal(await copyTextToClipboard('x'), false);
  });
  await withGlobals({ navigator: undefined, document: undefined }, async () => {
    assert.equal(await copyTextToClipboard('x'), false);
  });
});

test('handleCodeBlockCopyClick: 边界拦截与成功/恢复状态机', async () => {
  setLocale('zh-CN');
  let clipCalls = 0;

  await withGlobals({
    navigator: { clipboard: { writeText: async () => { clipCalls += 1; } } },
  }, async () => {
    assert.equal(await handleCodeBlockCopyClick(null), false);
    assert.equal(await handleCodeBlockCopyClick({}), false);
    assert.equal(await handleCodeBlockCopyClick({ closest: () => null }), false);
    assert.equal(await handleCodeBlockCopyClick(makeButton({ hasWrapper: false })), false);
    assert.equal(await handleCodeBlockCopyClick(makeButton({ hasCode: false, hasPre: false })), false);
    assert.equal(await handleCodeBlockCopyClick(makeButton({ codeText: '', hasPre: false })), false);
    assert.equal(await handleCodeBlockCopyClick(makeButton({ codeText: null, hasPre: false })), false);
    assert.equal(clipCalls, 0);
  });

  // pre > code 优先于 pre，且定时器 1500ms 恢复
  const timers = [];
  let written = '';
  const btn = makeButton({ codeText: 'exact-code', preText: 'should-not-use-pre' });
  await withGlobals({
    navigator: { clipboard: { writeText: async (t) => { written = t; } } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return 1; },
  }, async () => {
    assert.equal(await handleCodeBlockCopyClick(btn), true);
    assert.equal(written, 'exact-code');
    assert.equal(btn.textContent, '已复制');
    assert.equal(btn.dataset.copied, 'true');
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 1500);
    timers[0].fn();
    assert.equal(btn.textContent, '复制');
    assert.equal(btn.dataset.copied, undefined);
  });

  // 仅 pre 时 fallback 到 pre
  const preBtn = makeButton({ hasCode: false, preText: 'only-pre' });
  let preWritten = '';
  await withGlobals({
    navigator: { clipboard: { writeText: async (t) => { preWritten = t; } } },
    setTimeout: () => 1,
  }, async () => {
    assert.equal(await handleCodeBlockCopyClick(preBtn), true);
    assert.equal(preWritten, 'only-pre');
  });

  // 剪贴板失败时不改按钮状态
  const failBtn = makeButton({ codeText: 'abc' });
  await withGlobals({
    navigator: undefined,
    document: undefined,
    setTimeout: () => { assert.fail('失败时不得触发定时器'); },
  }, async () => {
    assert.equal(await handleCodeBlockCopyClick(failBtn), false);
    assert.equal(failBtn.textContent, '复制');
    assert.equal(failBtn.dataset.copied, undefined);
  });
});
