import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fuzzyPathMatch,
  mergeMentionCandidates,
  parseMentionToken,
} from '../../dist/renderer/mentionToken.mjs';

test('@ token 解析：路径必须能进补全分支', async (t) => {
  await t.test('绝对路径 token 被识别为路径', () => {
    // 【规则】历史正则只允许字母数字，`@/opt` 整个漏掉，表现为「@ 搜不到路径」。
    const token = parseMentionToken('看看 @/opt');
    assert.ok(token, '@/opt 必须被识别');
    assert.equal(token.query, '/opt');
    assert.equal(token.isPath, true);
  });

  await t.test('相对路径与家目录都算路径', () => {
    assert.equal(parseMentionToken('@./src').isPath, true);
    assert.equal(parseMentionToken('@~/notes').isPath, true);
    assert.equal(parseMentionToken('@src/opt').isPath, true);
  });

  await t.test('纯 Bot 名不算路径', () => {
    const token = parseMentionToken('@aura');
    assert.equal(token.isPath, false);
    assert.equal(token.query, 'aura');
  });

  await t.test('行首 @ 与空白后 @ 都能识别', () => {
    assert.equal(parseMentionToken('@/opt').query, '/opt');
    assert.equal(parseMentionToken('hi @/opt').query, '/opt');
  });

  await t.test('没有 @ 时返回 null', () => {
    assert.equal(parseMentionToken('普通文本'), null);
    assert.equal(parseMentionToken('email@host'), null);
  });

  await t.test('token 遇空白即结束，不跨越已完成的引用', () => {
    const token = parseMentionToken('@aura 继续写');
    assert.equal(token, null, '已结束的 @ 引用不应继续触发补全');
  });
});

test('文件模糊匹配：分段命中', async (t) => {
  await t.test('末段可前缀命中', () => {
    assert.equal(fuzzyPathMatch('src/renderer/index.ts', 'index'), true);
    assert.equal(fuzzyPathMatch('src/renderer/index.ts', 'ren'), true);
  });

  await t.test('跨段顺序匹配', () => {
    assert.equal(fuzzyPathMatch('packages/desktop/src/renderer/index.ts', 'renderer/index'), true);
    assert.equal(fuzzyPathMatch('packages/desktop/src/renderer/index.ts', 'desktop/index'), true);
  });

  await t.test('顺序颠倒不命中', () => {
    assert.equal(fuzzyPathMatch('packages/desktop/src/renderer/index.ts', 'index/renderer'), false);
  });

  await t.test('不存在的段不命中', () => {
    assert.equal(fuzzyPathMatch('src/renderer/index.ts', 'opt'), false);
  });

  await t.test('空 query 命中一切', () => {
    assert.equal(fuzzyPathMatch('anything', ''), true);
  });

  await t.test('绝对路径 query 与候选按段比对', () => {
    assert.equal(fuzzyPathMatch('/opt/data/cache', '/opt'), true);
    assert.equal(fuzzyPathMatch('/opt/data/cache', 'opt'), true);
  });
});

test('候选合并：网关结果不再二次过滤', async (t) => {
  const agents = [
    { type: 'agent', name: 'Aura', detail: 'aura' },
    { type: 'agent', name: 'CodeBoy', detail: 'codeboy' },
  ];

  await t.test('网关返回的文件项原样保留，哪怕字面不含 query', () => {
    // 【规则】历史实现用 includes 再筛一遍，把网关模糊命中的结果筛掉了。
    const files = [{ type: 'file', name: 'src/opt/a.ts', detail: '' }];
    const merged = mergeMentionCandidates({
      agentItems: agents,
      fileItems: files,
      query: '/opt',
      filesFromGateway: true,
    });
    assert.ok(merged.some((m) => m.name === 'src/opt/a.ts'), '网关权威结果不得被二次过滤');
  });

  await t.test('降级结果走本地模糊匹配', () => {
    const files = [
      { type: 'file', name: 'src/renderer/index.ts', detail: '' },
      { type: 'file', name: 'docs/readme.md', detail: '' },
    ];
    const merged = mergeMentionCandidates({
      agentItems: [],
      fileItems: files,
      query: 'renderer',
      filesFromGateway: false,
    });
    assert.deepEqual(merged.map((m) => m.name), ['src/renderer/index.ts']);
  });

  await t.test('Bot 在上、文件在下', () => {
    const merged = mergeMentionCandidates({
      agentItems: agents,
      fileItems: [{ type: 'file', name: 'a.ts', detail: '' }],
      query: '',
      filesFromGateway: true,
    });
    assert.equal(merged[0].type, 'agent');
    assert.equal(merged[merged.length - 1].type, 'file');
  });

  await t.test('Agent 名按 includes 匹配', () => {
    const merged = mergeMentionCandidates({
      agentItems: agents,
      fileItems: [],
      query: 'aur',
      filesFromGateway: true,
    });
    assert.deepEqual(merged.map((m) => m.name), ['Aura']);
  });
});
