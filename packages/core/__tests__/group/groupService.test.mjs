import test from 'node:test';
import assert from 'node:assert/strict';
import { GroupRoomStore } from '../../dist/group/groupService.js';

test('GroupRoomStore - 多 Agent 群聊房间与四阶拉群升级管线', async (t) => {
  await t.test('1. listRooms 与 getRoomState：房间列表与单个房间状态检索', async () => {
    const store = new GroupRoomStore();
    const mockBridge = {
      async request(method, params) {
        if (method === 'groups.list') {
          return {
            groups: [
              {
                roomId: 'grp-100',
                name: '前端与架构对齐会',
                members: ['arch-wang', 'fe-zhang'],
                createdAt: 1000,
                updatedAt: 1000,
              },
            ],
          };
        }
        if (method === 'groups.state') {
          assert.equal(params.room_id, 'grp-100');
          return {
            room_id: 'grp-100',
            name: '前端与架构对齐会',
            members: ['arch-wang', 'fe-zhang'],
            status: 'active',
            active_speaker: 'arch-wang',
          };
        }
        throw new Error(`Unexpected call: ${method}`);
      },
    };

    const rooms = await store.listRooms(mockBridge);
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].roomId, 'grp-100');

    const state = await store.getRoomState('grp-100', mockBridge);
    assert.equal(state.status, 'active');
    assert.equal(state.active_speaker, 'arch-wang');

    // 负向测试：网关返回畸变数据结构
    await assert.rejects(
      () => store.listRooms({ async request() { return {}; } }),
      /非法的 groups.list 响应数据结构/
    );

    // 负向测试：缺少 roomId
    await assert.rejects(() => store.getRoomState('', mockBridge), /Room ID is mandatory/);
  });

  await t.test('2. createRoom：创建房间与最少2名专家不变量', async () => {
    const store = new GroupRoomStore();
    const mockBridge = {
      async request(method, params) {
        assert.equal(method, 'groups.create');
        return {
          room_id: 'grp-test-001',
          name: params.name,
          members: params.members,
        };
      },
    };

    // 正向创建
    const res = await store.createRoom('架构评审会', ['arch-wang', 'fe-zhang'], mockBridge);
    assert.equal(res.room_id, 'grp-test-001');

    // 负向拦截：少于2名成员
    await assert.rejects(
      () => store.createRoom('单人空房间', ['arch-wang'], mockBridge),
      /requires at least 2 members/
    );

    // 负向拦截：空群名
    await assert.rejects(
      () => store.createRoom('', ['arch-wang', 'fe-zhang'], mockBridge),
      /Group name cannot be empty/
    );
  });

  await t.test('3. sendMessage 与 fetchLogs：房间独立事件流、监听订阅与负向参数守卫', async () => {
    const store = new GroupRoomStore();
    const receivedEntries = [];
    const unsub = store.subscribeRoom('grp-room-42', (entry) => {
      receivedEntries.push(entry);
    });

    const mockBridge = {
      async request(method, params) {
        if (method === 'groups.send') {
          // 官方契约断言：顶层只允许 room_id / event_id / payload
          assert.equal(typeof params.room_id, 'string');
          assert.equal(typeof params.event_id, 'string', 'event_id 必须是字符串（否则网关 4111）');
          assert.ok(params.event_id.length > 0);
          assert.equal(params.text, undefined, 'text 严禁平铺在顶层（网关 4000 Extra inputs）');
          assert.equal(typeof params.payload?.text, 'string');
          assert.equal(typeof params.payload?.thread_id, 'string', 'payload 必须含 thread_id（否则网关 5112）');
          return {
            event: {
              room_id: params.room_id,
              seq: 10,
              event_id: 'user:msg-1',
              kind: 'message.user',
              actor: { kind: 'user', id: 'desktop' },
              payload: { text: params.payload.text, thread_id: params.payload.thread_id },
              created_at: 1793456811.2291908,
            },
            client_event_id: params.event_id,
            accepted: true,
          };
        }
        if (method === 'groups.log') {
          return {
            room_id: params.room_id,
            entries: [
              { messageId: 'msg-seed', seq: 1, senderProfile: 'system', timestamp: 100, text: '种子消息', isSeed: true },
            ],
            latest_seq: 1,
          };
        }
        throw new Error(`Unexpected call: ${method}`);
      },
    };

    // 发送消息
    await store.sendMessage('grp-room-42', '大家好，开始讨论', 'arch-wang', mockBridge);
    assert.equal(receivedEntries.length, 1);
    assert.equal(receivedEntries[0].text, '大家好，开始讨论');
    assert.equal(receivedEntries[0].seq, 10);
    assert.equal(receivedEntries[0].actorKind, 'user');
    assert.ok(receivedEntries[0].threadId, '发送后必须回填 thread_id');

    // 负向：sendMessage 空参数拦截
    await assert.rejects(() => store.sendMessage('', '内容', 'user', mockBridge), /Room ID and text are mandatory/);
    await assert.rejects(() => store.sendMessage('grp-room-42', '', 'user', mockBridge), /Room ID and text are mandatory/);

    // 拉取历史日志
    const logs = await store.fetchLogs('grp-room-42', mockBridge);
    assert.equal(logs.length, 2);
    assert.equal(logs[0].seq, 1);
    assert.equal(logs[1].seq, 10);

    // 负向：fetchLogs 空 roomId
    await assert.rejects(() => store.fetchLogs('', mockBridge), /Room ID is mandatory for fetchLogs/);

    unsub();
  });

  await t.test('4. disbandRoom 与 renameRoom：房间状态与改名流转', async () => {
    const store = new GroupRoomStore();
    const mockBridge = {
      async request(method, params) {
        if (method === 'groups.create') {
          return { room_id: 'grp-state-1', name: params.name, members: params.members };
        }
        if (method === 'groups.rename') {
          assert.equal(params.new_name, '新会议名称');
          return { success: true };
        }
        if (method === 'groups.disband') {
          return { success: true };
        }
        throw new Error(`Unexpected method: ${method}`);
      },
    };

    await store.createRoom('旧会议', ['arch-wang', 'default'], mockBridge);
    const renamed = await store.renameRoom('grp-state-1', '新会议名称', mockBridge);
    assert.equal(renamed, true);

    const disbanded = await store.disbandRoom('grp-state-1', mockBridge);
    assert.equal(disbanded, true);
  });

  await t.test('5. promoteSessionToGroup：单聊一键拉群四阶工程管道闭环与负向校验', async () => {
    const store = new GroupRoomStore();
    let createdName = '';
    let seedText = '';
    let seedFlag = false;

    const mockBridge = {
      async request(method, params) {
        if (method === 'groups.create') {
          createdName = params.name;
          return { room_id: 'grp-promoted-888', name: params.name, members: params.members };
        }
        if (method === 'groups.send') {
          // 官方契约：种子正文必须落在 payload.text，线程 ID 必须存在
          seedText = params.payload?.text || '';
          seedFlag = typeof params.payload?.thread_id === 'string' && params.payload.thread_id.length > 0;
          return {
            event: {
              room_id: params.room_id,
              seq: 1,
              event_id: 'user:seed-1',
              kind: 'message.user',
              actor: { kind: 'user', id: 'desktop' },
              payload: { text: seedText, thread_id: params.payload.thread_id },
              created_at: 1793456811.2291908,
            },
            accepted: true,
          };
        }
        throw new Error(`Unexpected method: ${method}`);
      },
    };

    const res = await store.promoteSessionToGroup(
      {
        parentSessionId: 'sess-parent-42',
        originalTitle: 'OAuth回调死锁排查',
        groupName: 'OAuth死锁协同研讨群',
        selectedMembers: ['arch-wang', 'fe-zhang', 'sec-auditor'],
        sourceMessages: [
          { role: 'user', content: '发现每次切换账号时，本地回调端口偶发假死' },
          { role: 'assistant', content: '初步判断是主线程 FSM 互斥锁未释放导致' },
        ],
      },
      mockBridge
    );

    // 验证四阶流水线产出
    assert.equal(res.roomId, 'grp-promoted-888');
    assert.equal(res.groupName, 'OAuth死锁协同研讨群');
    assert.equal(createdName, 'OAuth死锁协同研讨群');

    // 验证种子备忘录提取
    assert.equal(seedFlag, true, '必须作为 Room 0 种子消息固化');
    assert.ok(seedText.includes('### 📋 会议前序背景摘要'));
    assert.ok(seedText.includes('@arch-wang'));
    assert.ok(seedText.includes('@fe-zhang'));
    assert.ok(seedText.includes('发现每次切换账号时'));

    // 验证原单聊末尾跳转锚点卡片文本
    assert.ok(res.anchorCardText.includes('📌 本会话已升级为多Agent研讨群聊'));
    assert.ok(res.anchorCardText.includes('room: grp-promoted-888'));

    // 负向：缺失 parentSessionId
    await assert.rejects(
      () =>
        store.promoteSessionToGroup(
          {
            parentSessionId: '',
            groupName: '测试群',
            selectedMembers: ['arch-wang', 'fe-zhang'],
          },
          mockBridge
        ),
      /Parent session ID is required/
    );

    // 负向：成员不足 2 人
    await assert.rejects(
      () =>
        store.promoteSessionToGroup(
          {
            parentSessionId: 'sess-1',
            groupName: '失败群',
            selectedMembers: ['arch-wang'],
          },
          mockBridge
        ),
      /至少需要选择 2 位专家/
    );
  });
});
