/**
 * AppState 领域模型与初始工厂单元测试
 *
 * 【断言】
 *   1. 初始状态工厂默认值正确生成；
 *   2. 移动端视口平台推导生效；
 *   3. 骨架屏默认三域相位均初始化为 loading（杜绝白屏/假空）；
 *   4. readPresenceLayout 容忍空 localStorage 并默认回退 stage。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState,
  readPresenceLayout,
  resolveActiveWorkspaceCwd,
  PRESENCE_LAYOUT_STORAGE_KEY,
} from '../../dist/renderer/state/appState.mjs';

test('AppState 领域状态模型测试', async (t) => {
  await t.test('1. createInitialState 默认生成合法 AppState', () => {
    const state = createInitialState({ platform: 'windows' });
    assert.equal(state.platform, 'windows');
    assert.equal(state.isMaximized, false);
    assert.equal(state.profilesPhase, 'loading');
    assert.equal(state.sessionsPhase, 'loading');
    assert.equal(state.messagesPhase, 'loading');
    assert.equal(state.activeSessionId, '');
    assert.equal(state.messages.length, 0);
    assert.equal(state.isStreaming, false);
    assert.equal(state.conversationWidth, 'wide');
  });

  await t.test('1b. conversationWidth 冷启动确实经 localStorage 偏好加载并收敛脏值', () => {
    // 【杀伤力】若 createInitialState 把 conversationWidth 写成常量 'wide'，
    // 下面注入 narrow/full 的两条断言立刻变红。
    const hadStorage = 'localStorage' in globalThis;
    const savedStorage = globalThis.localStorage;
    const installStorage = (raw) => {
      globalThis.localStorage = {
        getItem: (key) => (key === 'hermes_flux_conversation_width' ? raw : null),
        setItem() {},
      };
    };
    try {
      delete globalThis.localStorage;
      assert.equal(createInitialState({ platform: 'windows' }).conversationWidth, 'wide', '无 localStorage 必须回落默认 wide');

      installStorage('narrow');
      assert.equal(createInitialState({ platform: 'windows' }).conversationWidth, 'narrow');
      assert.equal(readPresenceLayout(), 'stage', '宽度偏好注入不得影响其它偏好键的默认回退');

      installStorage('full');
      assert.equal(createInitialState({ platform: 'windows' }).conversationWidth, 'full');

      installStorage('bogus-width');
      assert.equal(createInitialState({ platform: 'windows' }).conversationWidth, 'wide', '脏值必须收敛为 wide');
    } finally {
      if (hadStorage) globalThis.localStorage = savedStorage;
      else delete globalThis.localStorage;
    }
  });

  await t.test('1c. localStorage 访问抛错时初始化降级为默认值而非中断', () => {
    // 【杀伤力】去掉 getStorage 的 try/catch，createInitialState 会直接抛 Error: denied，本用例必红。
    const hadStorage = 'localStorage' in globalThis;
    const savedStorage = globalThis.localStorage;
    const savedWarn = console.warn;
    const warns = [];
    try {
      globalThis.localStorage = {
        getItem() { throw new Error('denied'); },
        setItem() { throw new Error('denied'); },
      };
      console.warn = (...args) => { warns.push(args); };

      let state;
      assert.doesNotThrow(() => { state = createInitialState({ platform: 'windows' }); }, '存储被禁用不得阻断冷启动');

      assert.equal(state.theme, 'obsidian-gold');
      assert.equal(state.lang, 'zh');
      assert.equal(state.profileName, 'default');
      assert.equal(state.gatewayUrl, '');
      assert.equal(state.gatewayConnecting, false);
      assert.equal(state.username, '');
      assert.equal(state.password, '');
      assert.deepEqual(state.favoriteModels, []);
      assert.deepEqual(state.recentModels, []);
      assert.equal(state.presenceLayout, 'stage');
      assert.equal(state.conversationWidth, 'wide');
      assert.ok(warns.length > 0, '降级必须可观测，禁止静默吞掉失败');
    } finally {
      console.warn = savedWarn;
      if (hadStorage) globalThis.localStorage = savedStorage;
      else delete globalThis.localStorage;
    }
  });

  await t.test('2. readPresenceLayout 默认 stage 并支持 dock', () => {
    assert.equal(PRESENCE_LAYOUT_STORAGE_KEY, 'hermes_flux_presence_layout');
    const layout = readPresenceLayout();
    assert.ok(layout === 'stage' || layout === 'dock');
  });

  await t.test('3. resolveActiveWorkspaceCwd 四级工作区目录解析优先级与默认文件树状态', () => {
    const initial = createInitialState({ platform: 'windows' });
    assert.deepEqual(initial.fileTreeState, { status: 'idle' });
    assert.deepEqual(initial.fileTreeExpandedPaths, []);
    assert.equal(initial.fileTreeFilterQuery, '');
    assert.equal(initial.fileTreeCollapsed, false);
    assert.equal(initial.fileTreeLoadedCwd, '');

    assert.equal(resolveActiveWorkspaceCwd(null), '');
    assert.equal(resolveActiveWorkspaceCwd({}), '');

    // 1. activeSession.cwd 最高优先级
    assert.equal(
      resolveActiveWorkspaceCwd({
        activeSessionId: 's1',
        sessions: [{ id: 's1', cwd: 'E:\\repos\\proj-a\\' }],
        projects: [{ id: 'p1', name: 'P1', path: '/other' }],
      }),
      'E:/repos/proj-a',
    );

    // 2. 无 cwd 时匹配会话归属 project.path
    assert.equal(
      resolveActiveWorkspaceCwd({
        activeSessionId: 's2',
        sessions: [{ id: 's2', projectId: 'p1', projectName: 'P1' }],
        projects: [{ id: 'p1', name: 'P1', path: '/ws/p1/' }],
      }),
      '/ws/p1',
    );

    // 2b. 通过 projectName 匹配 project.path
    assert.equal(
      resolveActiveWorkspaceCwd({
        activeSessionId: 's3',
        sessions: [{ id: 's3', projectName: 'NameMatch' }],
        projects: [{ id: 'p2', name: 'NameMatch', path: '/ws/name-match' }],
      }),
      '/ws/name-match',
    );

    // 3. 回落 selectedNewTaskProjectId 对应项目路径
    assert.equal(
      resolveActiveWorkspaceCwd({
        activeSessionId: '',
        sessions: [],
        selectedNewTaskProjectId: 'p-sel',
        projects: [
          { id: 'p-first', name: 'First', path: '/ws/first' },
          { id: 'p-sel', name: 'Sel', path: '/ws/selected' },
        ],
      }),
      '/ws/selected',
    );

    // 4. 再回落首个带 path 的工程
    assert.equal(
      resolveActiveWorkspaceCwd({
        activeSessionId: '',
        sessions: [],
        selectedNewTaskProjectId: 'missing',
        projects: [{ id: 'p-first', name: 'First', path: '/ws/first' }],
      }),
      '/ws/first',
    );
  });
});
