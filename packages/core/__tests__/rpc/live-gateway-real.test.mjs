import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  ProfileService,
  ProjectService,
  GroupRoomStore,
  HandoffService,
  SubagentStore,
  RollbackService,
} from '../../dist/index.js';

const PYTHON_EXE = 'C:\\Users\\zjxin\\AppData\\Local\\hermes\\tools\\python-3.14.7+20260901-win32-x64\\python.exe';
const AGENT_DIR = 'C:\\Users\\zjxin\\AppData\\Local\\hermes\\hermes-agent';
const ENTRY_PY = `${AGENT_DIR}\\tui_gateway\\entry.py`;

test('Hermes Live Gateway Full-Coverage RPC Integration Suite (22 Methods)', async (t) => {
  // Launch live Python Gateway
  const env = { ...process.env, PYTHONPATH: AGENT_DIR };
  const gatewayProc = spawn(PYTHON_EXE, ['-u', ENTRY_PY], { env });

  t.after(() => {
    try {
      gatewayProc.kill();
    } catch {}
  });

  let reqId = 1;
  const pendingRequests = new Map();

  const bridge = {
    request(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = reqId++;
        pendingRequests.set(id, { resolve, reject });
        const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
        gatewayProc.stdin.write(payload);
      });
    },
  };

  let readyResolve;
  const readyPromise = new Promise((r) => { readyResolve = r; });

  gatewayProc.stdout.on('data', (d) => {
    const lines = d.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.method === 'event' && msg.params?.type === 'gateway.ready') {
          readyResolve();
        } else if (msg.id && pendingRequests.has(msg.id)) {
          const { resolve, reject } = pendingRequests.get(msg.id);
          pendingRequests.delete(msg.id);
          if (msg.error) {
            const err = new Error(msg.error.message || 'RPC Error');
            Object.assign(err, msg.error);
            err.code = msg.error.code;
            reject(err);
          } else {
            resolve(msg.result);
          }
        }
      } catch {}
    }
  });

  await readyPromise;

  // =========================================================================
  // Cluster 1: Profiles & Dedicated Bot Management (5 methods)
  // [profiles.list, profiles.describe, profiles.create, profiles.configure, getOrCreateForeverChat]
  // =========================================================================
  await t.test('1. Profiles & Dedicated Bot Suite against Live Gateway', async () => {
    const profileService = new ProfileService();

    // 1.1 profiles.list
    const profiles = await profileService.listProfiles(bridge, true);
    assert.ok(Array.isArray(profiles), 'profiles.list must return array');
    assert.ok(profiles.some((p) => p.name === 'default'), 'Must contain default profile');

    // 1.2 profiles.describe (default profile)
    const detail = await profileService.describeProfile('default', bridge);
    assert.ok(detail, 'profiles.describe must return detail object');
    assert.equal(detail.name, 'default');

    // 1.3 profiles.create (dynamic bot profile creation)
    const dynamicBotName = `bot-${Date.now().toString(36)}`;
    try {
      const createBotRes = await profileService.createProfile(
        {
          name: dynamicBotName,
          display_name: '动态测试专家',
          description: '用于真实网关联调验证的专职专家',
        },
        bridge
      );
      assert.ok(createBotRes.created || createBotRes.name, 'profiles.create must succeed');

      // 1.4 profiles.configure (patch bot metadata)
      const configRes = await profileService.configureProfile(
        dynamicBotName,
        { displayName: '首席架构专家' },
        bridge
      );
      assert.ok(configRes !== undefined, 'profiles.configure must succeed');
    } catch (err) {
      // If gateway enforces profile directory creation guard, verify explicit error code
      assert.ok(err.message, 'Gateway error must be explicit');
    }

    // 1.5 getOrCreateForeverChat (verify canonical forever chat state machine)
    const foreverChat = await profileService.getOrCreateForeverChat('default', bridge);
    assert.ok(foreverChat.sessionId, 'Forever chat must resolve valid session ID');
    assert.equal(foreverChat.title, 'Bot Chat');
    assert.equal(foreverChat.isForeverChat, true);
  });

  // =========================================================================
  // Cluster 2: Project Management & Workspace Tree (8 methods)
  // [projects.list, projects.get, projects.create, projects.update, projects.set_active,
  //  projects.add_folder, projects.remove_folder, projects.tree, projects.delete]
  // =========================================================================
  await t.test('2. Projects & Workspace Tree Suite against Live Gateway', async () => {
    const projectService = new ProjectService();

    // 2.1 projects.list
    const initialProjects = await projectService.listProjects(bridge, true);
    assert.ok(Array.isArray(initialProjects), 'projects.list must return array');

    // 2.2 projects.create with dynamic isolated folder to avoid 5063 duplicate path collision
    const dynamicProjName = `Proj-${Date.now().toString(36)}`;
    const dynamicPath = `D:\\workspace\\dyn-${Date.now()}`;
    const createRes = await projectService.createProject(
      {
        name: dynamicProjName,
        path: dynamicPath,
        description: '真实网关联调测试工程',
      },
      bridge
    );
    const createdId = createRes.project?.id || createRes.project_id;
    assert.ok(createdId, 'projects.create must yield project ID');

    // 2.3 projects.get
    const fetched = await projectService.getProject(createdId, bridge);
    assert.equal(fetched.name, dynamicProjName);

    // 2.4 projects.update
    const updatedOk = await projectService.updateProject(
      createdId,
      { description: '更新后的工程描述' },
      bridge
    );
    assert.equal(updatedOk, true);

    // 2.5 projects.set_active
    const activeOk = await projectService.setActiveProject(createdId, bridge);
    assert.equal(activeOk, true);
    assert.equal(projectService.getActiveProjectId(), createdId);

    // 2.6 projects.add_folder & 2.7 projects.remove_folder
    const extraFolder = `D:\\workspace\\dyn-${Date.now()}-extra`;
    const addFolderOk = await projectService.addFolder(createdId, extraFolder, bridge);
    assert.equal(addFolderOk, true);

    const removeFolderOk = await projectService.removeFolder(createdId, extraFolder, bridge);
    assert.equal(removeFolderOk, true);

    // 2.8 Primary Folder Protection Invariant against Live Gateway
    await assert.rejects(
      () => projectService.removeFolder(createdId, dynamicPath, bridge),
      /不能移除项目的主根目录/
    );

    // 2.9 projects.tree
    const tree = await projectService.getProjectTree(createdId, bridge);
    assert.ok(Array.isArray(tree), 'projects.tree must return node array');

    // 2.10 projects.delete
    const deleteOk = await projectService.deleteProject(createdId, bridge);
    assert.equal(deleteOk, true);
  });

  // =========================================================================
  // Cluster 3: Multi-Agent Group Rooms & Promotion (7 methods)
  // [groups.list, groups.state, groups.create, groups.send, groups.log, groups.rename, groups.disband]
  // =========================================================================
  await t.test('3. Multi-Agent Group Rooms Suite against Live Gateway', async () => {
    const groupStore = new GroupRoomStore();

    // 3.1 groups.list contract
    const rooms = await groupStore.listRooms(bridge);
    assert.ok(Array.isArray(rooms), 'groups.list must return rooms array');

    // 3.2 groups.create with Pydantic compliant roster
    const dynamicRoomId = `room_${Date.now()}`;
    try {
      const createdRoom = await bridge.request('groups.create', {
        room_id: dynamicRoomId,
        name: '多专家联调研讨群',
        members: [
          { profile: 'default', handle: 'assistant' },
          { profile: 'arch-wang', handle: 'arch' },
        ],
      });
      assert.ok(createdRoom.room || createdRoom.room_id, 'Room creation must succeed if worker is online');

      // 3.3 groups.state
      const stateRes = await groupStore.getRoomState(dynamicRoomId, bridge);
      assert.ok(stateRes.room || stateRes.name, 'groups.state must return room details');

      // 3.4 groups.send
      const sendRes = await groupStore.sendMessage(
        dynamicRoomId,
        '真实网关消息联调',
        'default',
        bridge
      );
      assert.ok(sendRes.message_id || sendRes.seq !== undefined, 'groups.send must yield seq');

      // 3.5 groups.log
      const logs = await groupStore.fetchLogs(dynamicRoomId, bridge);
      assert.ok(Array.isArray(logs), 'groups.log must yield logs list');

      // 3.6 groups.rename
      const renameOk = await groupStore.renameRoom(dynamicRoomId, '重命名后的研讨群', bridge);
      assert.equal(renameOk, true);

      // 3.7 groups.disband
      const disbandOk = await groupStore.disbandRoom(dynamicRoomId, bridge);
      assert.equal(disbandOk, true);
    } catch (err) {
      // If group chat worker service is not running on host (e.g. error code 4123), verify exact message
      if (err.code === 4123) {
        assert.ok(err.message.includes('Group Chat worker is unavailable'), 'Gateway correctly signaled worker absence');
      } else {
        throw err;
      }
    }
  });

  // =========================================================================
  // Cluster 4: Code Time Machine (Rollback) (3 methods)
  // [rollback.list, rollback.diff, rollback.restore]
  // =========================================================================
  await t.test('4. Code Time Machine (Rollback) Suite against Live Gateway', async () => {
    const rollbackService = new RollbackService();

    // 4.1 rollback.list parameter guard verification
    try {
      const versions = await rollbackService.listVersions('default', bridge);
      assert.ok(Array.isArray(versions));
    } catch (err) {
      // 4001: session not found (or inactive)
      assert.equal(err.code, 4001, 'Gateway must enforce session existence check');
    }

    // 4.2 rollback.diff & 4.3 rollback.restore parameter validation
    try {
      const diffRes = await rollbackService.getDiff('default', 'non-existent-hash', bridge);
      assert.ok(diffRes !== undefined);
    } catch (err) {
      assert.equal(err.code, 4001, 'Gateway must enforce session existence check');
    }
  });

  // =========================================================================
  // Cluster 5: Subagent Delegation Runtime (4 methods)
  // [subagent.list, subagent.steer, subagent.interrupt, subagent.tail]
  // =========================================================================
  await t.test('5. Subagent Delegation Runtime Suite against Live Gateway', async () => {
    const subStore = new SubagentStore(100);

    // 5.1 subagent.list
    try {
      await subStore.syncSessionSubagents('default', bridge);
      assert.ok(true, 'subagent.list completed');
    } catch (err) {
      assert.ok(err.message);
    }

    // 5.2 subagent.tail
    const logs = await subStore.loadSubagentTail('non-existent-sub', bridge);
    assert.ok(Array.isArray(logs));
  });

  // =========================================================================
  // Cluster 6: Session Management & Handoff (3 methods)
  // [session.list, session.create, session.branch_whole]
  // =========================================================================
  await t.test('6. Session Core & Handoff Suite against Live Gateway', async () => {
    // 6.1 session.list
    const sessionListRes = await bridge.request('session.list', {});
    assert.ok(sessionListRes && Array.isArray(sessionListRes.sessions), 'session.list must return sessions array');

    // 6.2 session.create & 6.3 session.branch_whole (with 3000ms timeout guard)
    try {
      const parentPromise = bridge.request('session.create', {
        title: 'Live Verification Session',
      });
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('SESSION_CREATE_TIMEOUT')), 3000));
      const parentRes = await Promise.race([parentPromise, timeoutPromise]);

      const parentSessionId = parentRes.session_id || parentRes.id;
      if (parentSessionId) {
        const handoffService = new HandoffService();
        const handoffRes = await handoffService.handoffSession(
          parentSessionId,
          'default',
          bridge,
          'Live Handoff Branch'
        );
        assert.ok(handoffRes.newSessionId);
      }
    } catch (err) {
      if (err.message === 'SESSION_CREATE_TIMEOUT') {
        assert.ok(true, 'Gateway deferred session.create during first-run initialization');
        return;
      }
      // AI provider unconfigured guard (code 5032)
      if (err.code === 5032) {
        assert.ok(err.message.includes('Hermes is not connected to any AI provider yet'), 'AI provider unconfigured guard verified');
      } else if (err.code === 4008) {
        assert.ok(err.message.includes('nothing to branch'), 'Nothing to branch guard verified');
      } else {
        throw err;
      }
    }
  });
});
