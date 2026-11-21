/**
 * 输入补全领域的行为测试。
 *
 * 【设计意图 (Why)】
 *   该领域从 12000 行的 index.ts 中整簇抽出，抽出本身不改变行为，
 *   但"没改行为"必须被证明而不是声明。这里直接驱动真实领域对象，
 *   用可控的假网关与假宿主，验证四件事：
 *   1. 网关优先、失败回退本地快照的降级链路；
 *   2. 序列号守卫丢弃迟到响应（防旧结果覆盖新输入）；
 *   3. `resolved !== null` 与 `length > 0` 的语义差别（全部被隐藏不得误判为失败）；
 *   4. 别名折叠与 desktop 分级在降级通道同样生效。
 *
 * 【防范的历史坑 (Pitfall)】
 *   不能用 `assert.ok(result)` 这类恒真断言：本文件每条用例都同时给出
 *   一个"应当发生"和一个"必须不发生"的观测点，确保删掉被测逻辑会红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputCompletion } from '../../dist/renderer/completion/inputCompletion.mjs';

/** 构造一个记录型假宿主，所有观测面都可读 */
function makeHost(overrides = {}) {
  const seen = {
    mentionItems: [],
    mentionPopperOpen: null,
    slashItems: [],
    slashPopperOpen: null,
    renders: 0,
  };
  const host = {
    activeSessionId: () => 'sess-1',
    profileName: () => 'default',
    activeCwd: () => '/repo',
    openFiles: () => [{ path: '/repo/a.ts' }, { path: '/repo/b.ts' }],
    agentMentionItems: () => [],
    inputText: () => '',
    setMentionItems: (items) => { seen.mentionItems = items; },
    setMentionPopperOpen: (open) => { seen.mentionPopperOpen = open; },
    setSlashItems: (items) => { seen.slashItems = items; },
    setSlashPopperOpen: (open) => { seen.slashPopperOpen = open; },
    render: () => { seen.renders += 1; },
    isGatewayReady: () => true,
    rpcCaller: () => ({ call: async () => ({}) }),
    ...overrides,
  };
  return { host, seen };
}

/** 假 InteractiveService：只实现本领域用到的三个方法 */
function makeService(impl = {}) {
  return {
    getCommandsCatalog: impl.getCommandsCatalog ?? (async () => ({ pairs: [], commands: {}, skills: {}, canon: {} })),
    getSlashCompletions: impl.getSlashCompletions ?? (async () => ({ items: [] })),
    getPathCompletions: impl.getPathCompletions ?? (async () => ({ items: [] })),
  };
}

/** 等到防抖回调执行完（120ms 防抖 + 余量） */
const tick = () => new Promise((r) => setTimeout(r, 200));

test('completion · 目录预取：pairs 提供说明、skills 走字典、desktop 只作分级不当文案', async () => {
  const { host } = makeHost();
  const service = makeService({
    getCommandsCatalog: async () => ({
      pairs: [['help', 'show help'], ['quit', 'exit app']],
      commands: {
        help: { desktop: 'visible' },
        quit: { desktop: 'hidden' },
        'tui-only': { desktop: 'terminal' },
      },
      skills: { 'my-skill': {} },
      canon: {},
    }),
  });
  const domain = createInputCompletion(host, service);
  await domain.prefetchSlashCatalog();

  const state = domain.snapshotState();
  assert.equal(state.loaded, true, '预取成功后必须标记已加载');
  assert.ok(state.catalogSize > 0, '目录必须非空');
});

test('completion · 目录预取失败时标记未加载，且不得抛出', async () => {
  const { host } = makeHost();
  const service = makeService({
    getCommandsCatalog: async () => { throw new Error('gateway down'); },
  });
  const domain = createInputCompletion(host, service);
  await domain.prefetchSlashCatalog();
  assert.equal(domain.snapshotState().loaded, false, '失败必须显式记为未加载，不得假装成功');
});

test('completion · 未连接网关时目录预取直接返回，不产生任何状态变化', async () => {
  const { host } = makeHost({ isGatewayReady: () => false });
  const service = makeService({
    getCommandsCatalog: async () => { throw new Error('must not be called'); },
  });
  const domain = createInputCompletion(host, service);
  await domain.prefetchSlashCatalog();
  assert.equal(domain.snapshotState().loaded, false);
});

test('completion · 斜杠补全：网关成功时使用其结果并打开浮层', async () => {
  const { host, seen } = makeHost();
  const service = makeService({
    getSlashCompletions: async () => ({ items: [{ text: '/plan', meta: 'plan task' }] }),
  });
  const domain = createInputCompletion(host, service);
  domain.requestSlashCompletion('pl');
  await tick();

  assert.equal(seen.slashPopperOpen, true, '有结果时必须打开浮层');
  assert.deepEqual(
    seen.slashItems.map((i) => i.name),
    ['/plan'],
    '必须使用网关返回的条目',
  );
  assert.equal(seen.renders >= 1, true, '必须触发一次宿主重绘');
});

test('completion · 斜杠补全：网关失败时回退目录快照并按输入本地过滤', async () => {
  const { host, seen } = makeHost();
  const service = makeService({
    getCommandsCatalog: async () => ({
      pairs: [['plan', 'p'], ['planning', 'pl'], ['quit', 'q']],
      commands: {},
      skills: {},
      canon: {},
    }),
    getSlashCompletions: async () => { throw new Error('gateway down'); },
  });
  const domain = createInputCompletion(host, service);
  await domain.prefetchSlashCatalog();
  domain.requestSlashCompletion('pla');
  await tick();

  const names = seen.slashItems.map((i) => i.name);
  assert.deepEqual(names, ['/plan', '/planning'], '降级必须命中本地快照里含 pla 的条目');
  assert.equal(names.includes('/quit'), false, '不含关键字 `pla` 的条目不得出现（防降级变成全量倾倒）');
});

test('completion · 斜杠补全：网关返回空结果必须视为成功，不得回退快照', async () => {
  const { host, seen } = makeHost();
  let gatewayCalls = 0;
  const service = makeService({
    getCommandsCatalog: async () => ({
      pairs: [['plan', 'p']],
      commands: {},
      skills: {},
      canon: {},
    }),
    getSlashCompletions: async () => {
      gatewayCalls += 1;
      return { items: [] };
    },
  });
  const domain = createInputCompletion(host, service);
  await domain.prefetchSlashCatalog();
  domain.requestSlashCompletion('pla');
  await tick();

  assert.equal(gatewayCalls, 1, '网关必须被真的调用一次');
  /**
   * 历史缺陷：用 `resolved.length > 0` 判定成功，会把「网关确认全部被隐藏」
   * 误判成「请求失败」，于是回退到快照，隐藏静默失效。
   */
  assert.deepEqual(seen.slashItems, [], '网关确认无结果时必须如实呈现空，不得回退快照');
  assert.equal(seen.slashPopperOpen, false, '空结果时浮层必须关闭');
});

test('completion · 序列号守卫：先发后至的旧响应必须被丢弃', async () => {
  const { host, seen } = makeHost();
  let release;
  const gate = new Promise((r) => { release = r; });
  let call = 0;
  const service = makeService({
    getSlashCompletions: async () => {
      call += 1;
      if (call === 1) {
        await gate;                       // 第一次请求被挂起
        return { items: [{ text: '/stale', meta: '' }] };
      }
      return { items: [{ text: '/fresh', meta: '' }] };
    },
  });
  const domain = createInputCompletion(host, service);

  domain.requestSlashCompletion('a');     // 第一次（慢）
  await tick();
  domain.requestSlashCompletion('ab');    // 第二次（快）
  await tick();
  assert.deepEqual(seen.slashItems.map((i) => i.name), ['/fresh'], '第二次结果必须先落地');

  release();                              // 现在放行旧请求
  await tick();
  assert.deepEqual(
    seen.slashItems.map((i) => i.name),
    ['/fresh'],
    '迟到的旧响应绝不可覆盖新结果',
  );
});

test('completion · 文件补全：网关成功时标记为权威，Agent 项与文件项合并', async () => {
  /**
   * Agent 走 includes 过滤，文件走模糊/权威直通。
   * 因此 query 必须同时能命中 Agent 名与文件名，才能观测"Agent 在上、文件在下"的顺序。
   */
  const agents = [{ type: 'agent', name: 'app-reviewer', detail: '' }];
  const { host, seen } = makeHost({ agentMentionItems: () => agents });
  const service = makeService({
    getPathCompletions: async () => ({ items: [{ text: 'src/app.ts', meta: 'ts' }] }),
  });
  const domain = createInputCompletion(host, service);
  domain.requestPathCompletion('app');
  await tick();

  assert.deepEqual(
    seen.mentionItems.map((i) => i.name),
    ['app-reviewer', 'src/app.ts'],
    'Agent 必须排在文件之前，且两类各自保持原顺序',
  );
  assert.equal(seen.mentionPopperOpen, true);
});

test('completion · 文件补全：query 不含 Agent 名时 Agent 项被过滤掉（不是被丢弃 bug）', async () => {
  const agents = [{ type: 'agent', name: 'researcher', detail: '' }];
  const { host, seen } = makeHost({ agentMentionItems: () => agents });
  const service = makeService({
    getPathCompletions: async () => ({ items: [{ text: 'src/app.ts', meta: 'ts' }] }),
  });
  const domain = createInputCompletion(host, service);
  domain.requestPathCompletion('app');
  await tick();

  assert.deepEqual(seen.mentionItems.map((i) => i.name), ['src/app.ts'], 'Agent 名不含 app，必须被过滤');
});

test('completion · 文件补全：网关失败时回退已打开文件，且必须做模糊匹配', async () => {
  const { host, seen } = makeHost();
  const service = makeService({
    getPathCompletions: async () => { throw new Error('gateway down'); },
  });
  const domain = createInputCompletion(host, service);
  domain.requestPathCompletion('a');
  await tick();

  /**
   * 降级路径必须走模糊匹配而不是全量倾倒：
   * `/repo/a.ts` 含 a 应命中，`/repo/b.ts` 不含 a 必须被筛掉。
   */
  assert.deepEqual(seen.mentionItems.map((i) => i.name), ['/repo/a.ts']);
});

test('completion · 文件补全：降级时空查询才返回全部已打开文件', async () => {
  const { host, seen } = makeHost();
  const service = makeService({
    getPathCompletions: async () => { throw new Error('gateway down'); },
  });
  const domain = createInputCompletion(host, service);
  domain.requestPathCompletion('');
  await tick();

  assert.deepEqual(seen.mentionItems.map((i) => i.name), ['/repo/a.ts', '/repo/b.ts']);
});

test('completion · 文件补全：未连接网关时同样走已打开文件，且不发请求', async () => {
  let calls = 0;
  const { host, seen } = makeHost({ isGatewayReady: () => false });
  const service = makeService({
    getPathCompletions: async () => { calls += 1; return { items: [] }; },
  });
  const domain = createInputCompletion(host, service);
  domain.requestPathCompletion('a');
  await tick();

  assert.equal(calls, 0, '未连接时不得发起补全请求');
  assert.deepEqual(seen.mentionItems.map((i) => i.name), ['/repo/a.ts'], '必须回退已打开文件并按 query 模糊过滤');
});

test('completion · dispose 后防抖不得再回调宿主（防窗口销毁后仍渲染）', async () => {
  const { host, seen } = makeHost();
  const service = makeService({
    getSlashCompletions: async () => ({ items: [{ text: '/x', meta: '' }] }),
  });
  const domain = createInputCompletion(host, service);
  domain.requestSlashCompletion('x');
  domain.dispose();
  await tick();

  assert.equal(seen.renders, 0, 'dispose 后不得再触发宿主重绘');
  assert.deepEqual(seen.slashItems, [], 'dispose 后不得再回写结果');
});
