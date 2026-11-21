/**
 * 工作区文件树服务核心单元测试 (packages/core/__tests__/fs/fileTreeService.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWorkspacePath,
  joinWorkspacePath,
  extractPathBasename,
  isIgnoredTreeEntryName,
  sortFileTreeNodes,
  entriesToFileTreeNodes,
  buildTreeFromFlatPaths,
  mergeDirectoryChildren,
  filterFileTree,
  collectAncestorDirectoryPaths,
  parseGatewayFilesPayload,
  resolveWorkspaceDirectory,
  isLoopbackGatewayUrl,
} from '../../dist/index.js';

test('路径规范化、拼接与基名提取', () => {
  assert.equal(normalizeWorkspacePath(''), '');
  assert.equal(normalizeWorkspacePath('///'), '/');
  assert.equal(normalizeWorkspacePath('C:\\\\repo\\\\src\\'), 'C:/repo/src');
  assert.equal(normalizeWorkspacePath('C:\\'), 'C:/');

  assert.equal(joinWorkspacePath('', 'a.ts'), 'a.ts');
  assert.equal(joinWorkspacePath('/repo', ''), '/repo');
  assert.equal(joinWorkspacePath('/', 'etc'), '/etc');
  assert.equal(joinWorkspacePath('/repo', 'src/index.ts'), '/repo/src/index.ts');

  assert.equal(extractPathBasename(''), '');
  assert.equal(extractPathBasename('/'), '/');
  assert.equal(extractPathBasename('C:/'), 'C:');
  assert.equal(extractPathBasename('/repo/packages/core'), 'core');
  assert.equal(extractPathBasename('file.txt'), 'file.txt');

  assert.equal(isIgnoredTreeEntryName('.'), true);
  assert.equal(isIgnoredTreeEntryName('..'), true);
  assert.equal(isIgnoredTreeEntryName('.git'), true);
  assert.equal(isIgnoredTreeEntryName('src'), false);
});

test('entriesToFileTreeNodes 去重、文件升级为目录并按目录优先+码点排序', () => {
  const nodes = entriesToFileTreeNodes([
    { name: 'z.ts', path: '/ws/z.ts', isDirectory: false, size: 10 },
    { name: '.git', path: '/ws/.git', isDirectory: true },
    { name: 'empty-path-ignored', path: '', isDirectory: false },
    { name: '', path: '/ws/derived.ts', isDirectory: false },
    { name: 'dup', path: '/ws/dup', isDirectory: false },
    { name: 'dup', path: '/ws/dup', isDirectory: true },
    { name: 'dup', path: '/ws/dup', isDirectory: false },
    { name: 'a.ts', path: '/ws/a.ts', isDirectory: false },
    { name: 'B', path: '/ws/B', isDirectory: true },
    { name: 'a', path: '/ws/a', isDirectory: true },
  ]);

  assert.deepEqual(
    nodes.map((n) => `${n.isDirectory ? 'D' : 'F'}:${n.name}`),
    ['D:B', 'D:a', 'D:dup', 'F:a.ts', 'F:derived.ts', 'F:z.ts'],
  );
  assert.equal(nodes[3].size, undefined);
  assert.equal(nodes[5].size, 10);
});

test('buildTreeFromFlatPaths 支持空输入、同名文件升级目录与跨盘符路径', () => {
  const tree = buildTreeFromFlatPaths(
    [
      '',
      '/ws',
      '/ws/README.md',
      '/ws/pkg',
      '/ws/pkg/entry.ts',
      '/ws/packages/core/index.ts',
      '/ws/packages/core',
      '/ws/packages/core/',
      '/ws/../escape.ts',
      '/ws/.git/config',
      'C:/other/main.ts',
    ],
    '/ws',
  );

  assert.equal(tree.length, 4);
  assert.equal(tree[0].name, 'other');
  assert.equal(tree[1].name, 'packages');
  assert.equal(tree[1].children?.[0].name, 'core');
  assert.equal(tree[1].children?.[0].isDirectory, true);
  assert.equal(tree[1].children?.[0].children?.[0].name, 'index.ts');
  assert.equal(tree[2].name, 'pkg');
  assert.equal(tree[2].isDirectory, true);
  assert.equal(tree[2].children?.[0].name, 'entry.ts');
  assert.equal(tree[3].name, 'README.md');

  // rootPath 为 '/' 或空串时的相对切片分支
  const rootSlashTree = buildTreeFromFlatPaths(['/a/b.ts', 'bare.txt'], '/');
  assert.equal(rootSlashTree.length, 2);
  const emptyRootTree = buildTreeFromFlatPaths(['foo/bar.ts'], '');
  assert.equal(emptyRootTree[0].name, 'foo');
});

test('sortFileTreeNodes 与 mergeDirectoryChildren 及 filterFileTree 边缘分支', () => {
  const unsorted = [
    { name: 'b.ts', path: '/ws/b.ts', isDirectory: false },
    { name: 'b.ts', path: '/ws/a/b.ts', isDirectory: false },
    {
      name: 'sub',
      path: '/ws/sub',
      isDirectory: true,
      children: [{ name: 'c.ts', path: '/ws/sub/c.ts', isDirectory: false }],
    },
  ];
  const sorted = sortFileTreeNodes(unsorted);
  assert.equal(sorted[0].name, 'sub');
  assert.equal(sorted[1].path, '/ws/a/b.ts');

  assert.equal(mergeDirectoryChildren(sorted, '', []).length, 3);
  const unchanged = mergeDirectoryChildren(sorted, '/ws/missing', []);
  assert.equal(unchanged.length, 3);

  const deepTree = buildTreeFromFlatPaths(
    ['/ws/a/b/c.ts', '/ws/a/other.md', '/ws/x/y.ts'],
    '/ws',
  );
  const mergedDeep = mergeDirectoryChildren(deepTree, '/ws/a/b', [
    { name: 'new.ts', path: '/ws/a/b/new.ts', isDirectory: false },
  ]);
  assert.equal(
    mergedDeep[0].children?.[0].children?.[0].name,
    'new.ts',
  );

  const filteredSelfDir = filterFileTree(mergedDeep, 'a');
  assert.equal(filteredSelfDir.length, 1);
  assert.equal(filteredSelfDir[0].name, 'a');
  assert.equal(filteredSelfDir[0].children?.length, 2);

  const leafMatchOnly = filterFileTree(mergedDeep, 'new.ts');
  assert.equal(leafMatchOnly.length, 1);
  assert.equal(leafMatchOnly[0].children?.length, 1);

  const emptySubdirTree = [{ name: 'empty', path: '/ws/empty', isDirectory: true }];
  assert.equal(filterFileTree(emptySubdirTree, 'empty')[0].children, undefined);
  assert.equal(filterFileTree(emptySubdirTree, 'nomatch').length, 0);
});

test('collectAncestorDirectoryPaths 提取到根目录前的各级祖先', () => {
  assert.deepEqual(collectAncestorDirectoryPaths('', '/ws'), []);
  assert.deepEqual(collectAncestorDirectoryPaths('file.ts', ''), []);
  assert.deepEqual(collectAncestorDirectoryPaths('C:/a.ts', ''), []);
  assert.deepEqual(collectAncestorDirectoryPaths('/outside/a.ts', '/ws'), []);
  assert.deepEqual(collectAncestorDirectoryPaths('/a/b/c.ts', '/'), ['/a', '/a/b']);
  assert.deepEqual(
    collectAncestorDirectoryPaths('/ws/packages/core/src/index.ts', '/ws'),
    ['/ws/packages', '/ws/packages/core', '/ws/packages/core/src'],
  );
  const sampleTree = [{ name: 'a.ts', path: '/ws/a.ts', isDirectory: false }];
  assert.equal(filterFileTree(sampleTree, '').length, 1);
  assert.equal(filterFileTree(sampleTree, null).length, 1);
});

test('parseGatewayFilesPayload 解析多种形状并拦截 SPA HTML 回退', () => {
  assert.equal(parseGatewayFilesPayload(null, '/ws'), null);
  assert.equal(parseGatewayFilesPayload(42, '/ws'), null);
  assert.equal(parseGatewayFilesPayload('<!DOCTYPE html><html><div id="root"></div></html>', '/ws'), null);

  const savedWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(parseGatewayFilesPayload('{broken-json', ''), null);
  } finally {
    console.warn = savedWarn;
  }

  assert.equal(parseGatewayFilesPayload({ unknown: true }, '/ws'), null);
  assert.equal(parseGatewayFilesPayload({ items: ['item.ts'] }, '/ws')?.[0].name, 'item.ts');
  assert.equal(parseGatewayFilesPayload({ data: ['data.ts'] }, '/ws')?.[0].name, 'data.ts');

  const fromStrings = parseGatewayFilesPayload(
    ['src/', 'win\\', '/ws/abs.ts', 'README.md', '.git', '', 123],
    '/ws',
  );
  assert.deepEqual(fromStrings, [
    { name: 'src', path: '/ws/src', isDirectory: true },
    { name: 'win', path: '/ws/win', isDirectory: true },
    { name: 'abs.ts', path: '/ws/abs.ts', isDirectory: false },
    { name: 'README.md', path: '/ws/README.md', isDirectory: false },
  ]);

  const fromObjects = parseGatewayFilesPayload(
    {
      entries: [
        null,
        { name: 123, path: 456, type: 789 },
        { filename: '.git' },
        { filename: 'lib', is_dir: true, path: '/ws/lib' },
        { file_path: '/ws/index.ts', type: 'file', size: 128 },
        { name: 'app\\sub.ts' },
      ],
    },
    '/ws',
  );
  assert.equal(fromObjects?.length, 3);
  assert.equal(fromObjects?.[0].isDirectory, true);
  assert.equal(fromObjects?.[1].size, 128);
});

test('resolveWorkspaceDirectory 四级级联解析：Local PAL -> Gateway API -> CompletePath -> Fallback -> Explicit Error', async () => {
  const savedWarn = console.warn;
  const warns = [];
  console.warn = (...a) => warns.push(a);

  try {
    // 1. Tier 1: Local PAL direct hit + root derivation when targetDir empty
    const t1 = await resolveWorkspaceDirectory('', {
      platformBridge: {
        listDirectory: async () => [{ name: 'a.ts', path: 'C:\\ws\\a.ts', isDirectory: false }],
      },
    });
    assert.ok('nodes' in t1);
    assert.equal(t1.source, 'local_fs');
    assert.equal(t1.rootPath, 'C:/ws');

    const t1Root = await resolveWorkspaceDirectory('', {
      platformBridge: {
        listDirectory: async () => [{ name: 'etc', path: '/etc', isDirectory: true }],
      },
    });
    assert.ok('nodes' in t1Root && t1Root.rootPath === '/');

    const t1Drive = await resolveWorkspaceDirectory('', {
      platformBridge: {
        listDirectory: async () => [{ name: 'foo', path: 'C:/foo', isDirectory: true }],
      },
    });
    assert.ok('nodes' in t1Drive && t1Drive.rootPath === 'C:/');

    const t1Empty = await resolveWorkspaceDirectory('', {
      platformBridge: { listDirectory: async () => [] },
    });
    assert.ok('nodes' in t1Empty && t1Empty.rootPath === '');

    // 2. Tier 1 throws -> Tier 2 Gateway API hits
    const t2 = await resolveWorkspaceDirectory('/ws', {
      gatewayUrl: 'http://127.0.0.1:8080',
      platformBridge: {
        listDirectory: async () => { throw new Error('ipc down'); },
        httpProxy: async () => ({ files: [{ name: 'remote.py', type: 'file' }] }),
      },
    });
    assert.ok('nodes' in t2);
    assert.equal(t2.source, 'gateway_api');
    assert.equal(t2.nodes[0].name, 'remote.py');

    // 3. Tier 2 throws -> Tier 3 complete.path hits
    const t3 = await resolveWorkspaceDirectory('/ws', {
      gatewayUrl: 'http://127.0.0.1:8080',
      platformBridge: {
        httpProxy: async () => { throw new Error('gateway 502'); },
      },
      completePath: async () => ['src/main.ts', 'docs/'],
    });
    assert.ok('nodes' in t3);
    assert.equal(t3.source, 'gateway_rpc');

    // 4. Tier 3 fails -> Tier 4 fallbackPaths hits
    const t4 = await resolveWorkspaceDirectory('/ws', {
      completePath: async () => { throw new Error('rpc timeout'); },
      fallbackPaths: ['/ws/cached/a.ts'],
    });
    assert.ok('nodes' in t4);
    assert.equal(t4.source, 'session_cache');

    // 5. All tiers fail / empty -> explicit error (含非 Error 抛错与无斜杠 deriveCommonParent)
    const errRes = await resolveWorkspaceDirectory('/ws', {
      platformBridge: { listDirectory: async () => { throw 'raw-err'; } },
      fallbackPaths: ['../bad'],
    });
    assert.deepEqual(errRes, { error: 'raw-err' });

    const bareEntryRes = await resolveWorkspaceDirectory('', {
      platformBridge: { listDirectory: async () => [{ name: 'bare.ts', path: 'bare.ts', isDirectory: false }] },
    });
    assert.ok('nodes' in bareEntryRes && bareEntryRes.rootPath === '');

    const defaultErr = await resolveWorkspaceDirectory('/ws', {});
    assert.deepEqual(defaultErr, { error: 'Unable to read workspace directory' });
    assert.ok(warns.length >= 4);
  } finally {
    console.warn = savedWarn;
  }
});

test('远程网关真实契约适配：is_directory 目录识别、/api/fs/list 回退与非回环网关隔离', async () => {
  const savedWarn = console.warn;
  console.warn = () => {};
  try {
    // 1. isLoopbackGatewayUrl 分支全覆盖
    assert.equal(isLoopbackGatewayUrl(undefined), true);
    assert.equal(isLoopbackGatewayUrl(''), true);
    assert.equal(isLoopbackGatewayUrl('127.0.0.1:8080'), true);
    assert.equal(isLoopbackGatewayUrl('http://127.0.0.1:9119'), true);
    assert.equal(isLoopbackGatewayUrl('ws://localhost:8080/ws'), true);
    assert.equal(isLoopbackGatewayUrl('http://[::1]:8080'), true);
    assert.equal(isLoopbackGatewayUrl('gateway.example.com'), false);
    assert.equal(isLoopbackGatewayUrl('https://remote.example.com:8443'), false);

    // 2. parseGatewayFilesPayload 精准识别真实 Hermes Gateway `is_directory: true` / `kind: 'folder'` / `dir: true` / `byteSize`
    const gwRealShape = parseGatewayFilesPayload(
      {
        path: '/opt/data/workspace',
        entries: [
          { name: 'memory', path: '/opt/data/workspace/memory', is_directory: true, size: null, kind: 123 },
          { name: 'folderA', kind: 'folder' },
          { name: 'folderB', dir: true },
          { name: 'folderC', type: 'folder' },
          { name: 'folderD', kind: 'directory' },
          { name: 'folderE', kind: 'dir' },
          { name: 'notes.md', path: '/opt/data/workspace/notes.md', is_directory: false, byteSize: 4358 },
          { name: 'badNum', size: -5, byteSize: -1, is_directory: false },
        ],
      },
      '/opt/data/workspace',
    );
    assert.equal(gwRealShape?.length, 8);
    assert.equal(gwRealShape?.[0].isDirectory, true);
    assert.equal(gwRealShape?.[1].isDirectory, true);
    assert.equal(gwRealShape?.[2].isDirectory, true);
    assert.equal(gwRealShape?.[3].isDirectory, true);
    assert.equal(gwRealShape?.[4].isDirectory, true);
    assert.equal(gwRealShape?.[5].isDirectory, true);
    assert.equal(gwRealShape?.[6].isDirectory, false);
    assert.equal(gwRealShape?.[6].size, 4358);
    assert.equal(gwRealShape?.[7].size, undefined);

    // 3. 远程非回环网关 + 空目标目录时，跳过本机 listDirectory，直接命中 /api/files 并提取服务端根 path
    let localCalled = false;
    const proxyCalls = [];
    const remoteDefault = await resolveWorkspaceDirectory('', {
      gatewayUrl: 'https://remote-gw.example.com:9119',
      profile: 'coder',
      platformBridge: {
        listDirectory: async () => {
          localCalled = true;
          return [];
        },
        httpProxy: async ({ path: ep }) => {
          proxyCalls.push(ep);
          return {
            path: '/opt/data/workspace',
            entries: [
              { name: 'memory', path: '/opt/data/workspace/memory', is_directory: true, size: null },
              { name: 'SOUL.md', path: '/opt/data/workspace/SOUL.md', is_directory: false, size: 512 },
            ],
          };
        },
      },
    });
    assert.equal(localCalled, false, '远程非回环网关空目录不得回落读取本机目录');
    assert.equal(proxyCalls[0], '/api/files');
    assert.ok('nodes' in remoteDefault);
    assert.equal(remoteDefault.rootPath, '/opt/data/workspace');
    assert.equal(remoteDefault.nodes[0].name, 'memory');
    assert.equal(remoteDefault.nodes[0].isDirectory, true);

    // 4. `/api/files` 报错越界时自动回退到 `/api/fs/list?path=...&profile=...`
    const fallbackCalls = [];
    const fsListFallback = await resolveWorkspaceDirectory('/etc/hermes', {
      gatewayUrl: 'https://remote-gw.example.com:9119',
      profile: 'ssh-dev',
      platformBridge: {
        httpProxy: async ({ path: ep }) => {
          fallbackCalls.push(ep);
          if (ep.startsWith('/api/files?')) throw new Error('HTTP 403 locked_root');
          return {
            entries: [
              { name: 'conf.d', path: '/etc/hermes/conf.d', isDirectory: true },
              { name: 'app.yaml', path: '/etc/hermes/app.yaml', isDirectory: false },
            ],
          };
        },
      },
    });
    assert.equal(fallbackCalls.length, 2);
    assert.match(fallbackCalls[1], /^\/api\/fs\/list\?path=%2Fetc%2Fhermes&profile=ssh-dev$/);
    assert.ok('nodes' in fsListFallback && fsListFallback.nodes[0].isDirectory === true);

    // 5. 空目录 + 无 path 字段 / 相对路径按 resolvedRoot 解析 / 顶层数组响应 + /api/fs/list 回退分支覆盖
    const relativeResolved = await resolveWorkspaceDirectory('', {
      gatewayUrl: 'http://127.0.0.1:9119',
      platformBridge: {
        httpProxy: async ({ path: ep }) => {
          if (ep === '/api/files') {
            return {
              path: '/remote/ws',
              entries: [{ name: 'rel.ts', is_directory: false }],
            };
          }
          return null;
        },
      },
    });
    assert.ok('nodes' in relativeResolved && relativeResolved.rootPath === '/remote/ws');
    assert.equal(relativeResolved.nodes[0].path, '/remote/ws/rel.ts');

    const emptyFsList = await resolveWorkspaceDirectory('', {
      gatewayUrl: 'http://127.0.0.1:9119',
      platformBridge: {
        httpProxy: async ({ path: ep }) => {
          if (ep === '/api/files') return 'not-json-or-empty';
          return { entries: [{ name: 'solo.txt', isDirectory: false }] };
        },
      },
    });
    assert.ok('nodes' in emptyFsList && emptyFsList.rootPath === '');

    const arrayRootList = await resolveWorkspaceDirectory('', {
      gatewayUrl: 'http://127.0.0.1:9119',
      platformBridge: {
        httpProxy: async () => ['arr-item.ts'],
      },
    });
    assert.ok('nodes' in arrayRootList && arrayRootList.rootPath === '');
    assert.equal(arrayRootList.nodes[0].name, 'arr-item.ts');
  } finally {
    console.warn = savedWarn;
  }
});
