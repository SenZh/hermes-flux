/**
 * 对话区列宽档位偏好与 CSS 变量契约测试（tokens/conversationWidth + styles/conversation.css）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CONVERSATION_WIDTH_MODES,
  CONVERSATION_WIDTH_STORAGE_KEY,
  CONVERSATION_WIDTH_TOKENS,
  DEFAULT_CONVERSATION_WIDTH_MODE,
  applyConversationWidthMode,
  loadConversationWidthMode,
  resolveConversationWidthMode,
  saveConversationWidthMode,
} from '../dist/tokens/conversationWidth.js';

const ROOT = path.resolve(import.meta.dirname, '..');

function installStorage(initial) {
  const store = new Map(Object.entries(initial ?? {}));
  const calls = { reads: 0, writes: [] };
  globalThis.localStorage = {
    getItem(key) {
      calls.reads += 1;
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      calls.writes.push([key, value]);
      store.set(key, value);
    },
  };
  return { store, calls };
}

function restoreStorage() {
  delete globalThis.localStorage;
}

function createFakeRoot() {
  const attrs = new Map();
  const props = new Map();
  return {
    attrs,
    props,
    setAttribute(name, value) {
      attrs.set(name, value);
    },
    style: {
      setProperty(name, value) {
        props.set(name, value);
      },
    },
  };
}

test('对话区列宽真值表：三档有序、默认 wide、Token 映射确定', () => {
  assert.deepEqual([...CONVERSATION_WIDTH_MODES], ['narrow', 'wide', 'full']);
  assert.equal(DEFAULT_CONVERSATION_WIDTH_MODE, 'wide');
  assert.equal(CONVERSATION_WIDTH_STORAGE_KEY, 'hermes_flux_conversation_width');
  assert.deepEqual(CONVERSATION_WIDTH_TOKENS, {
    narrow: '48rem',
    wide: '72rem',
    full: '100%',
  });
});

test('resolveConversationWidthMode：合法值原样返回，非法/空值回落 wide', () => {
  for (const mode of CONVERSATION_WIDTH_MODES) {
    assert.equal(resolveConversationWidthMode(mode), mode);
  }
  for (const dirty of ['', 'WIDE', 'normal', 'wide ', null, undefined]) {
    assert.equal(resolveConversationWidthMode(dirty), DEFAULT_CONVERSATION_WIDTH_MODE);
  }
});

test('load/saveConversationWidthMode：无 localStorage、正常往返、脏值收敛、隐私模式容错', () => {
  restoreStorage();
  assert.equal(loadConversationWidthMode(), 'wide');
  assert.doesNotThrow(() => saveConversationWidthMode('full'));

  const good = installStorage({ [CONVERSATION_WIDTH_STORAGE_KEY]: 'narrow' });
  assert.equal(loadConversationWidthMode(), 'narrow');
  assert.equal(good.calls.reads, 1);

  installStorage({ [CONVERSATION_WIDTH_STORAGE_KEY]: 'invalid-width' });
  assert.equal(loadConversationWidthMode(), 'wide');

  const { calls } = installStorage();
  saveConversationWidthMode('full');
  saveConversationWidthMode('bogus');
  assert.deepEqual(calls.writes, [
    [CONVERSATION_WIDTH_STORAGE_KEY, 'full'],
    [CONVERSATION_WIDTH_STORAGE_KEY, 'wide'],
  ]);
  for (const mode of CONVERSATION_WIDTH_MODES) {
    saveConversationWidthMode(mode);
    assert.equal(loadConversationWidthMode(), mode);
  }

  globalThis.localStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  assert.equal(loadConversationWidthMode(), 'wide');
  assert.doesNotThrow(() => saveConversationWidthMode('narrow'));
  restoreStorage();
});

test('applyConversationWidthMode：显式 root、null root 与默认 document.documentElement 均按契约写入', () => {
  const root = createFakeRoot();
  for (const mode of CONVERSATION_WIDTH_MODES) {
    const resolved = applyConversationWidthMode(mode, root);
    assert.equal(resolved, mode);
    assert.equal(root.attrs.get('data-chat-layout'), mode);
    assert.equal(root.props.get('--chat-column-max'), CONVERSATION_WIDTH_TOKENS[mode]);
  }

  assert.equal(applyConversationWidthMode('bogus', root), 'wide');
  assert.equal(root.attrs.get('data-chat-layout'), 'wide');
  assert.equal(root.props.get('--chat-column-max'), '72rem');

  assert.equal(applyConversationWidthMode('full', null), 'full');

  const hadDocument = 'document' in globalThis;
  const savedDocument = globalThis.document;
  try {
    delete globalThis.document;
    assert.equal(applyConversationWidthMode('narrow'), 'narrow');

    const docRoot = createFakeRoot();
    globalThis.document = { documentElement: docRoot };
    assert.equal(applyConversationWidthMode('full'), 'full');
    assert.equal(docRoot.attrs.get('data-chat-layout'), 'full');
    assert.equal(docRoot.props.get('--chat-column-max'), '100%');
  } finally {
    if (hadDocument) globalThis.document = savedDocument;
    else delete globalThis.document;
  }
});

test('conversation.css：支持 narrow / wide / full 三档画布列宽且输入舱保持 740px 居中', () => {
  const css = fs
    .readFileSync(path.join(ROOT, 'src/styles/conversation.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  assert.match(css, /--conv-column-narrow:\s*48rem;/);
  assert.match(css, /--conv-column-wide:\s*72rem;/);
  assert.match(css, /--conv-column-full:\s*100%;/);
  assert.match(css, /--conv-column-max:\s*var\(--chat-column-max,\s*var\(--conv-column-wide\)\);/);

  for (const [mode, tokenVar, pxVal] of [
    ['narrow', '--conv-column-narrow', '48rem'],
    ['wide', '--conv-column-wide', '72rem'],
    ['full', '--conv-column-full', '100%'],
  ]) {
    const re = new RegExp(`\\[data-chat-layout="${mode}"\\][^{]*\\{([\\s\\S]*?)\\}`);
    const match = re.exec(css);
    assert.ok(match, `缺少 [data-chat-layout="${mode}"] 样式规则`);
    assert.ok(match[1].includes(`--chat-column-max: ${pxVal}`), `${mode} 必须设置 --chat-column-max`);
    assert.ok(match[1].includes(`--conv-column-max: var(${tokenVar})`), `${mode} 必须设置 --conv-column-max`);
  }

  const dockContainer = /\.input-dock-container\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
  assert.ok(dockContainer.includes('align-items: center'), '输入舱外层容器必须保持居中对齐');

  const dockBox = /\.input-card-box\.composer-dock\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
  assert.ok(dockBox.includes('max-width: 740px'), '输入舱外壳必须严格保持 740px 黄金限宽');
  assert.ok(dockBox.includes('margin: 0 auto'), '输入舱外壳必须保持水平居中');
});
