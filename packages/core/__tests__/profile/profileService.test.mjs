import test from 'node:test';
import assert from 'node:assert/strict';
import { ProfileService } from '../../dist/profile/profileService.js';

test('ProfileService - 专职 Bot 管理与 Forever Chat 终身主工位状态机', async (t) => {
  await t.test('1. listProfiles：获取专职 Bot 列表与内存缓存复用', async () => {
    const service = new ProfileService();
    let callCount = 0;
    const mockBridge = {
      async request(method) {
        assert.equal(method, 'profiles.list');
        callCount++;
        return {
          profiles: [
            { name: 'default', displayName: '主助理', isDefault: true },
            { name: 'arch-wang', displayName: '架构老王' },
          ],
        };
      },
    };

    const list1 = await service.listProfiles(mockBridge);
    assert.equal(list1.length, 2);
    assert.equal(callCount, 1);

    // 第二次调用命中内存缓存
    const list2 = await service.listProfiles(mockBridge);
    assert.equal(list2.length, 2);
    assert.equal(callCount, 1, '未强制刷新时必须复用内存缓存');

    // 强制刷新
    const list3 = await service.listProfiles(mockBridge, true);
    assert.equal(list3.length, 2);
    assert.equal(callCount, 2);

    // 负向测试：网关返回畸变数据结构
    await assert.rejects(
      () => service.listProfiles({ async request() { return {}; } }, true),
      /非法的 profiles.list 响应数据结构/
    );
  });

  await t.test('2. describeProfile：查询 Bot 专属沙箱档案与负向防护', async () => {
    const service = new ProfileService();
    const mockBridge = {
      async request(method, params) {
        assert.equal(method, 'profiles.describe');
        if (params.name === 'arch-wang') {
          return {
            profile: {
              name: 'arch-wang',
              displayName: '架构老王',
              systemPrompt: 'You are senior architect.',
              tools: ['bash', 'read_file'],
            },
          };
        }
        return { profile: null };
      },
    };

    const detail = await service.describeProfile('arch-wang', mockBridge);
    assert.equal(detail.name, 'arch-wang');
    assert.equal(detail.tools?.length, 2);

    // 负向：空名称或不存在
    await assert.rejects(() => service.describeProfile('', mockBridge), /Profile name is mandatory/);
    await assert.rejects(() => service.describeProfile('ghost-bot', mockBridge), /未找到 Bot 配置档/);
  });

  await t.test('3. createProfile 与 configureProfile：动态创建与属性配置', async () => {
    const service = new ProfileService();
    let createdName = '';
    let configuredPatch = null;

    const mockBridge = {
      async request(method, params) {
        if (method === 'profiles.create') {
          createdName = params.name;
          return { name: params.name, created: true };
        }
        if (method === 'profiles.configure') {
          configuredPatch = params.patch;
          return { success: true };
        }
        if (method === 'profiles.list') {
          return {
            profiles: [
              { name: 'sec-guard', displayName: '安全守卫' },
            ],
          };
        }
        throw new Error(`Unexpected call: ${method}`);
      },
    };

    // 正向创建
    const resCreate = await service.createProfile({ name: 'sec-guard', display_name: '安全守卫' }, mockBridge);
    assert.equal(resCreate.name, 'sec-guard');
    assert.equal(createdName, 'sec-guard');

    // 负向创建：名称为空
    await assert.rejects(() => service.createProfile({ name: '' }, mockBridge), /Bot profile name cannot be empty/);

    // 正向配置
    const okConfig = await service.configureProfile('sec-guard', { displayName: '首席安全官' }, mockBridge);
    assert.equal(okConfig, true);
    assert.equal(configuredPatch?.displayName, '首席安全官');
  });

  await t.test('4. getAsset 与 setAsset：Bot 头像与静态资产存取', async () => {
    const service = new ProfileService();
    let setKey = '';
    let setBase64 = '';

    const mockBridge = {
      async request(method, params) {
        if (method === 'profiles.get_asset') {
          if (params.key === 'avatar.png') {
            return { asset_base64: 'data:image/png;base64,AAAA' };
          }
          return {};
        }
        if (method === 'profiles.set_asset') {
          setKey = params.key;
          setBase64 = params.base64;
          return { success: true };
        }
        throw new Error(`Unexpected call: ${method}`);
      },
    };

    // 获取存在的资产
    const asset = await service.getAsset('arch-wang', 'avatar.png', mockBridge);
    assert.equal(asset, 'data:image/png;base64,AAAA');

    // 获取不存在的资产（返回 null，非异常）
    const missing = await service.getAsset('arch-wang', 'non-existent.png', mockBridge);
    assert.equal(missing, null);

    // 设置资产
    const ok = await service.setAsset('arch-wang', 'avatar.png', 'data:image/png;base64,BBBB', mockBridge);
    assert.equal(ok, true);
    assert.equal(setKey, 'avatar.png');
    assert.equal(setBase64, 'data:image/png;base64,BBBB');
  });

  await t.test('5. getOrCreateForeverChat：已有主工位时直接检索复用', async () => {
    const service = new ProfileService();
    let setHiddenCalled = false;
    const mockBridge = {
      async request(method, params) {
        if (method === 'session.list') {
          assert.equal(params.profile, 'arch-wang');
          return {
            sessions: [
              { id: 'sess-scratch-1', title: '临时调试' },
              { id: 'sess-bot-forever-chat', title: 'Bot Chat', created_at: 1000 },
            ],
          };
        }
        if (method === 'session.set_hidden') {
          setHiddenCalled = true;
          return { success: true };
        }
        throw new Error(`Unexpected call: ${method}`);
      },
    };

    const chat = await service.getOrCreateForeverChat('arch-wang', mockBridge);
    assert.equal(chat.sessionId, 'sess-bot-forever-chat');
    assert.equal(chat.title, 'Bot Chat');
    assert.equal(chat.isForeverChat, true);
    assert.equal(setHiddenCalled, false, '已有主工位无需重复 set_hidden');
  });

  await t.test('6. getOrCreateForeverChat：不存在时自动创建并设置 hidden=1', async () => {
    const service = new ProfileService();
    let createdPayload = null;
    let setHiddenPayload = null;

    const mockBridge = {
      async request(method, params) {
        if (method === 'session.list') {
          return { sessions: [] };
        }
        if (method === 'session.create') {
          createdPayload = params;
          return { session_id: 'sess-new-forever-chat' };
        }
        if (method === 'session.set_hidden') {
          setHiddenPayload = params;
          return { success: true };
        }
        throw new Error(`Unexpected call: ${method}`);
      },
    };

    const chat = await service.getOrCreateForeverChat('fe-zhang', mockBridge);
    assert.equal(chat.sessionId, 'sess-new-forever-chat');
    assert.equal(chat.isForeverChat, true);
    assert.equal(createdPayload?.title, 'Bot Chat');
    assert.equal(createdPayload?.profile, 'fe-zhang');
    assert.equal(setHiddenPayload?.session_id, 'sess-new-forever-chat');
    assert.equal(setHiddenPayload?.hidden, true);
  });

  await t.test('7. getOrCreateForeverChat：网络失败严禁伪装为空 (Failure Is Not Empty 显式抛出)', async () => {
    const service = new ProfileService();
    const failingBridge = {
      async request(method) {
        if (method === 'session.list') {
          throw new Error('Connection refused: Gateway offline');
        }
        throw new Error(`Unexpected method: ${method}`);
      },
    };

    // 严禁吞掉错误并创建重复的 Bot Chat，必须显式抛出
    await assert.rejects(
      () => service.getOrCreateForeverChat('arch-wang', failingBridge),
      /Connection refused: Gateway offline/
    );

    // 负向参数拦截
    await assert.rejects(
      () => service.getOrCreateForeverChat('', failingBridge),
      /Bot profile name is mandatory/
    );
  });

  await t.test('8. canCommitLongTermMemory 与 clearCache：记忆防毒化规则与缓存重置', () => {
    const service = new ProfileService();
    // 只有主工位可以写入 MEMORY.md
    assert.equal(service.canCommitLongTermMemory({ isForeverChat: true }), true);
    assert.equal(service.canCommitLongTermMemory({ isForeverChat: false }), false);
    assert.equal(service.canCommitLongTermMemory({}), false);

    service.clearCache();
  });
});
