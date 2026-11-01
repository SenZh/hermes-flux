import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProfileService } from '../../dist/profile/profileService.js';
import { GroupRoomStore } from '../../dist/group/groupService.js';
import { ProjectService } from '../../dist/project/projectService.js';
import { normalizeSessionsResult } from '../../dist/models/types.js';

/**
 * 真实网关 fixture 驱动测试
 *
 * 设计意图 (Why):
 *   测试里的"网关"必须是真实网关录下来的响应，而不是我们脑补的形状。
 *   否则生产代码改错了，测试照样绿——本次四个坑全部属于这种情况。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 手写 mock 按错误假设写（如 groups.send 返回 { message_id }），
 *      导致契约错误永远测不出来。
 *   2. 只断言"没抛错"，不断言字段，等于没测。
 *
 * 约束与规则 (Rules):
 *   - fixture 只能由 `npm run probe:gateway` 生成，禁止手写；
 *   - 每个断言都必须能因生产代码改错而变红；
 *   - 没有 fixture 时整组跳过，不伪造数据。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(HERE, '..', 'fixtures', 'gateway');

function loadFixture(method) {
  const file = path.join(FIXTURE_DIR, `${method.replace(/\./g, '_')}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadIndex() {
  const file = path.join(FIXTURE_DIR, 'index.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 传输桩：只替换物理网络，业务解析全部走真实生产代码 */
function fixtureBridge(method, result) {
  return {
    async request(requested) {
      assert.equal(requested, method, `预期调用 ${method}，实际 ${requested}`);
      return result;
    },
  };
}

const index = loadIndex();

test('真实网关 fixture 契约回归', async (t) => {
  if (!index) {
    t.skip('未找到 gateway fixture，请先运行 npm run probe:gateway');
    return;
  }

  await t.test('1. ping 是真实存在的存活探针（心跳看门狗依赖它）', () => {
    const fixture = loadFixture('ping');
    assert.ok(fixture, '缺少 ping fixture');
    assert.equal(fixture.result.pong, true, '网关 ping 必须返回 { pong: true }');

    // 反向守卫：曾经使用不存在的 system.ping，导致看门狗从未生效
    const methods = index.cases.map((c) => c.method);
    assert.ok(methods.includes('ping'), 'index 必须记录 ping 探针');
    assert.ok(!methods.includes('system.ping'), 'system.ping 不存在，严禁回归');
  });

  await t.test('2. profiles.list 归一化必须保留 ui_meta 与 has_avatar', async () => {
    const fixture = loadFixture('profiles.list');
    assert.ok(fixture, '缺少 profiles.list fixture');

    const service = new ProfileService();
    const profiles = await service.listProfiles(fixtureBridge('profiles.list', fixture.result), true);

    assert.ok(profiles.length > 0, '必须解析出至少一个 profile');
    const first = profiles[0];
    assert.equal(typeof first.name, 'string');
    assert.ok(first.name.length > 0);

    // 真实响应里存在 ui_meta 时，必须原样保留（旧群聊的唯一来源）
    const rawWithMeta = fixture.result.profiles.find((p) => p.ui_meta);
    if (rawWithMeta) {
      const parsed = profiles.find((p) => p.name === rawWithMeta.name);
      assert.ok(parsed.uiMeta, `${rawWithMeta.name} 的 ui_meta 被丢弃了——旧群聊会永远查不到`);
      assert.deepEqual(parsed.uiMeta, rawWithMeta.ui_meta, 'ui_meta 必须原样透传，不得裁剪内部键');
    }

    // has_avatar 必须保留，否则无法判断是否需要拉取资产
    assert.equal(typeof first.hasAvatar, 'boolean');
  });

  await t.test('3. profiles.get_asset 真实响应形状：data 为 data URL', async () => {
    const fixture = loadFixture('profiles.get_asset');
    assert.ok(fixture, '缺少 profiles.get_asset fixture');
    assert.equal(fixture.result.found, true, '探测用的 Bot 必须有头像资产');
    assert.equal(typeof fixture.result.data, 'string');
    // fixture 已脱敏为 <data-url:N>，真实响应是 data:image/...
    assert.ok(
      fixture.result.data.startsWith('<data-url:') || fixture.result.data.startsWith('data:'),
      `data 必须是 data URL，实际 ${fixture.result.data.slice(0, 40)}`
    );
  });

  await t.test('4. groups.list 真实响应必须能解析出房间与成员', async () => {
    const fixture = loadFixture('groups.list');
    assert.ok(fixture, '缺少 groups.list fixture');
    assert.ok(Array.isArray(fixture.result.rooms), 'groups.list 返回 { rooms }');

    const store = new GroupRoomStore();
    const rooms = await store.listRooms(fixtureBridge('groups.list', fixture.result));

    // fixture 的数组尾部带 `<more:N>` 占位符（脱敏截断），只断言真实对象条目
    const realRooms = fixture.result.rooms.filter((r) => r && typeof r === 'object');
    assert.equal(rooms.length, realRooms.length, '房间数量必须与真实响应一致');
    for (const room of rooms) {
      assert.ok(room.roomId, 'roomId 不得为空');
      assert.ok(Array.isArray(room.members), 'members 必须是数组');
    }
  });

  await t.test('5. session.list 真实响应必须能归一化出 id/title/timestamp', () => {
    const fixture = loadFixture('session.list');
    assert.ok(fixture, '缺少 session.list fixture');

    const sessions = normalizeSessionsResult(fixture.result);
    assert.ok(sessions.length > 0, '真实响应里必须有会话');

    for (const session of sessions) {
      assert.ok(session.id, '会话必须有 id');
      assert.equal(typeof session.title, 'string');
      assert.ok(session.title.length > 0, 'title 必须有兜底值');
      assert.equal(typeof session.timestamp, 'number');
      assert.ok(session.timestamp > 0, 'timestamp 必须被解析成毫秒数');
    }
  });

  await t.test('6. model.options 真实响应必须能提取出模型列表', async () => {
    const fixture = loadFixture('model.options');
    assert.ok(fixture, '缺少 model.options fixture');
    const { extractAvailableModels } = await import('../../dist/models/types.js');
    const models = extractAvailableModels(fixture.result, []);
    assert.ok(models.length > 0, '必须能从真实响应中提取模型');
  });

  await t.test('7. projects.list 真实响应必须能解析出工程列表', async () => {
    const fixture = loadFixture('projects.list');
    assert.ok(fixture, '缺少 projects.list fixture');
    const service = new ProjectService();
    const projects = await service.listProjects(fixtureBridge('projects.list', fixture.result), true);
    assert.ok(Array.isArray(projects), 'projects.list 必须解析成数组');
    for (const project of projects) {
      assert.ok(project.projectId, 'projectId 不得为空');
    }
  });

  await t.test('8. 负向探针：网关对多余/缺失字段返回精确错误码（严格模式证据）', () => {
    const negatives = index.cases.filter((c) => c.kind === 'negative');
    assert.ok(negatives.length >= 2, '必须至少记录两条负向探针');

    for (const negative of negatives) {
      assert.equal(typeof negative.code, 'number', `${negative.name} 必须记录错误码`);
      assert.ok(negative.code > 0, `${negative.name} 错误码必须为正`);
    }

    const assetNegative = negatives.find((n) => n.method === 'profiles.get_asset');
    assert.ok(assetNegative, '必须记录 profiles.get_asset 的严格模式证据');
    assert.equal(assetNegative.code, 4000, '多余字段必须返回 4000');
    assert.match(assetNegative.message, /Extra inputs are not permitted/);

    const missingThread = negatives.find((n) => n.name.includes('thread_id'));
    assert.ok(missingThread, '必须记录 groups.send 缺 thread_id 的证据');
    assert.equal(missingThread.code, 5112, '缺少 thread_id 必须返回 5112');
  });

  await t.test('9. 全部 fixture 完整性：每个文件都必须是真实录制且结构合法', () => {
    const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json');
    assert.ok(files.length >= 40, `fixture 数量应覆盖全部调用面，实际 ${files.length}`);

    for (const file of files) {
      const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
      assert.equal(typeof fixture.method, 'string', `${file} 缺少 method`);
      assert.ok(fixture.method.length > 0, `${file} method 为空`);
      assert.equal(typeof fixture.recordedAt, 'string', `${file} 缺少 recordedAt`);
      assert.ok(fixture.recordedAt.includes('T'), `${file} recordedAt 不是 ISO 时间`);
      assert.equal(typeof fixture.gatewayVersion, 'string', `${file} 缺少 gatewayVersion`);
      assert.ok(fixture.result && typeof fixture.result === 'object', `${file} 缺少 result`);

      // 守卫分支的 fixture 必须带明确的错误码，不能是空对象
      if ('__guard' in fixture.result) {
        assert.equal(typeof fixture.result.__guard, 'number', `${file} 守卫码必须是数字`);
      }
      // 脱敏红线：fixture 里不得出现真实 data URL 或绝对路径
      const raw = JSON.stringify(fixture);
      assert.ok(!raw.includes('data:image/'), `${file} 泄露了未脱敏的 data URL`);
      assert.ok(!/[A-Za-z]:\\\\Users/.test(raw), `${file} 泄露了本机绝对路径`);
    }
  });

  await t.test('10. groups 模块：send/log/rename/disband 的真实响应形状', () => {
    const send = loadFixture('groups.send');
    assert.ok(send, '缺少 groups.send fixture');
    assert.ok(send.result.event, 'groups.send 必须返回 { event }');
    assert.equal(typeof send.result.event.seq, 'number');
    assert.equal(send.result.event.kind, 'message.user');
    assert.equal(typeof send.result.event.payload.thread_id, 'string', 'payload 必须含 thread_id');
    assert.equal(send.result.accepted, true);

    const log = loadFixture('groups.log');
    assert.ok(log, '缺少 groups.log fixture');
    assert.ok(Array.isArray(log.result.events), 'groups.log 返回 { events }');

    const rename = loadFixture('groups.rename');
    assert.ok(rename?.result?.room, 'groups.rename 必须返回 { room }，不是 success 布尔');

    const disband = loadFixture('groups.disband');
    assert.ok(disband, '缺少 groups.disband fixture');
    // disband 可能走守卫分支（房间已被前置步骤解散）
    if (!('__guard' in disband.result)) {
      assert.ok(disband.result.tombstone, 'groups.disband 必须返回 { tombstone }');
    }
  });

  await t.test('11. sessions 模块：live id 与 stored id 的作用域差异', () => {
    const resume = loadFixture('session.resume');
    assert.ok(resume, '缺少 session.resume fixture');
    assert.ok(resume.result.session_id, 'resume 必须返回 live id');
    assert.ok(resume.result.stored_session_id, 'resume 必须返回 stored id');

    const create = loadFixture('session.create');
    assert.ok(create, '缺少 session.create fixture');
    assert.ok(create.result.session_id && create.result.stored_session_id);

    const del = loadFixture('session.delete');
    assert.ok(del, '缺少 session.delete fixture');
    if ('__guard' in del.result) {
      assert.ok([4023, 4007].includes(del.result.__guard), '空会话删除只能走守卫分支');
    }
  });

  await t.test('12. projects 模块：create/get/update/tree 的真实响应形状', () => {
    const list = loadFixture('projects.list');
    assert.ok(list?.result?.projects, 'projects.list 返回 { projects }');

    const created = loadFixture('projects.create');
    assert.ok(created, '缺少 projects.create fixture');
    if (!('__guard' in created.result)) {
      assert.ok(created.result.project?.id, 'projects.create 必须返回 { project: { id } }');
    }

    const tree = loadFixture('projects.tree');
    assert.ok(tree, '缺少 projects.tree fixture');
    assert.ok(Array.isArray(tree.result.projects), 'projects.tree 返回 { projects }');
  });

  await t.test('13. rollback 与 subagent 模块：守卫与空结果必须可区分', () => {
    const rollbackList = loadFixture('rollback.list');
    assert.ok(rollbackList, '缺少 rollback.list fixture');
    if (!('__guard' in rollbackList.result)) {
      assert.equal(typeof rollbackList.result.enabled, 'boolean');
      assert.ok(Array.isArray(rollbackList.result.checkpoints));
    }

    const subagentList = loadFixture('subagent.list');
    assert.ok(subagentList, '缺少 subagent.list fixture');
    if (!('__guard' in subagentList.result)) {
      assert.ok(Array.isArray(subagentList.result.subagents));
    }

    const tail = loadFixture('subagent.tail');
    assert.ok(tail, '缺少 subagent.tail fixture');
    if (!('__guard' in tail.result)) {
      assert.equal(typeof tail.result.available, 'boolean', 'tail 必须明确告知可用性');
    }
  });

  await t.test('14. prompt 模块：submit 与 btw 的真实返回形状', () => {
    const submit = loadFixture('prompt.submit');
    assert.ok(submit, '缺少 prompt.submit fixture');
    if (!('__guard' in submit.result)) {
      // 真实返回 { status, user_row_id }：提交即返回，不等待回合结束
      assert.equal(typeof submit.result.status, 'string', 'prompt.submit 必须返回 status');
      assert.ok(
        ['streaming', 'queued', 'complete', 'completed'].includes(submit.result.status),
        `status 必须是已知取值，实际 ${submit.result.status}`
      );
      assert.equal(typeof submit.result.user_row_id, 'number', '必须返回 user_row_id');
    }

    const btw = loadFixture('prompt.btw');
    assert.ok(btw, '缺少 prompt.btw fixture');
    if (!('__guard' in btw.result)) {
      // 真实返回 { task_id }：答案是异步经事件流到达，不存在同步 response
      assert.equal(typeof btw.result.task_id, 'string', 'prompt.btw 必须返回 task_id');
      assert.ok(btw.result.task_id.length > 0);
      assert.equal(btw.result.response, undefined, '严禁再假设存在同步 response 字段');
    }
  });
});
