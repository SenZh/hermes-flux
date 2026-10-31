import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectService, RollbackService } from '../../dist/project/projectService.js';

test('ProjectService - 项目工程管理与工作区目录树', async (t) => {
  await t.test('1. listProjects 与 setActiveProject：项目列表拉取与激活状态', async () => {
    const service = new ProjectService();
    const mockBridge = {
      async request(method, params) {
        if (method === 'projects.list') {
          return {
            projects: [
              {
                id: 'proj-1',
                name: 'Hermes Flux',
                slug: 'hermes-flux',
                primary_path: '/projects/hermes-flux',
                folders: [],
                is_active: false,
                created_at: 1000,
                updated_at: 1000,
              },
            ],
          };
        }
        if (method === 'projects.set_active') {
          assert.equal(params.id, 'proj-1');
          return { success: true };
        }
        throw new Error(`Unexpected call: ${method}`);
      },
    };

    const projects = await service.listProjects(mockBridge);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].slug, 'hermes-flux');

    const ok = await service.setActiveProject('proj-1', mockBridge);
    assert.equal(ok, true);
    assert.equal(service.getActiveProjectId(), 'proj-1');

    // 负向测试：网关返回畸变数据结构
    await assert.rejects(
      () => service.listProjects({ async request() { return {}; } }, true),
      /非法的 projects.list 响应数据结构/
    );

    // 负向测试：setActiveProject 缺少 ID
    await assert.rejects(() => service.setActiveProject('', mockBridge), /Project ID is mandatory/);
  });

  await t.test('2. getProject, createProject, updateProject 与 deleteProject：CRUD 全流程覆盖', async () => {
    const service = new ProjectService();
    let createdPayload = null;
    let updatedPatch = null;
    let deletedId = '';

    const mockBridge = {
      async request(method, params) {
        if (method === 'projects.get') {
          if (params.id === 'proj-crud-1') {
            return {
              project: {
                id: 'proj-crud-1',
                name: '测试项目',
                slug: 'test-proj',
                primary_path: '/opt/projects/test',
                folders: [],
                is_active: true,
                created_at: 1000,
                updated_at: 1000,
              },
            };
          }
          return { project: null };
        }
        if (method === 'projects.create') {
          createdPayload = params;
          return { project: { id: 'proj-new-99', name: params.name, primary_path: params.primary_path } };
        }
        if (method === 'projects.update') {
          updatedPatch = params;
          return { success: true };
        }
        if (method === 'projects.delete') {
          deletedId = params.id;
          return { success: true };
        }
        if (method === 'projects.list') {
          return { projects: [] };
        }
        throw new Error(`Unexpected method: ${method}`);
      },
    };

    // getProject 正向与负向
    const p = await service.getProject('proj-crud-1', mockBridge);
    assert.equal(p.name, '测试项目');
    await assert.rejects(() => service.getProject('', mockBridge), /Project ID is mandatory/);
    await assert.rejects(() => service.getProject('ghost-id', mockBridge), /未找到指定项目/);

    // createProject 正向与负向
    const resCreate = await service.createProject(
      { name: '新前端工程', path: '/opt/projects/fe' },
      mockBridge
    );
    assert.equal(resCreate.project?.id, 'proj-new-99');
    assert.equal(createdPayload?.name, '新前端工程');
    await assert.rejects(() => service.createProject({ name: '', path: '/path' }, mockBridge), /mandatory/);
    await assert.rejects(() => service.createProject({ name: 'name', path: '' }, mockBridge), /mandatory/);

    // updateProject 正向与负向
    const okUpdate = await service.updateProject('proj-crud-1', { name: '已重命名工程' }, mockBridge);
    assert.equal(okUpdate, true);
    assert.equal(updatedPatch?.name, '已重命名工程');
    await assert.rejects(() => service.updateProject('', {}, mockBridge), /Project ID is mandatory/);

    // deleteProject 正向与负向
    const okDelete = await service.deleteProject('proj-crud-1', mockBridge);
    assert.equal(okDelete, true);
    assert.equal(deletedId, 'proj-crud-1');
    await assert.rejects(() => service.deleteProject('', mockBridge), /Project ID is mandatory/);
  });

  await t.test('3. addFolder 与 removeFolder：附加目录管理与主根目录保护不变量 (含未命中缓存穿透核验)', async () => {
    const service = new ProjectService();
    const mockBridge = {
      async request(method, params) {
        if (method === 'projects.get') {
          assert.equal(params.id, 'proj-no-cache');
          return {
            project: {
              id: 'proj-no-cache',
              name: '未缓存工程',
              slug: 'no-cache',
              primary_path: '/opt/repos/primary-root',
              folders: [{ path: '/opt/repos/primary-root' }, { path: '/opt/repos/extra-1' }],
              is_active: false,
              created_at: 1000,
              updated_at: 1000,
            },
          };
        }
        if (method === 'projects.list') {
          return {
            projects: [
              {
                id: 'proj-10',
                name: '核心工程',
                slug: 'core-repo',
                primary_path: '/opt/repos/main',
                folders: [{ path: '/opt/repos/main' }, { path: '/opt/repos/docs' }],
                is_active: true,
                created_at: 1000,
                updated_at: 1000,
              },
            ],
          };
        }
        if (method === 'projects.add_folder') {
          return { success: true };
        }
        if (method === 'projects.remove_folder') {
          return { success: true };
        }
        throw new Error(`Unexpected call: ${method}`);
      },
    };

    await service.listProjects(mockBridge);

    // 正常增加与移除附加目录
    const added = await service.addFolder('proj-10', '/opt/repos/plugins', mockBridge);
    assert.equal(added, true);

    const removed = await service.removeFolder('proj-10', '/opt/repos/docs', mockBridge);
    assert.equal(removed, true);

    // 铁律红线：不能移除 primaryPath（命中内存缓存时拦截）
    await assert.rejects(
      () => service.removeFolder('proj-10', '/opt/repos/main', mockBridge),
      /不能移除项目的主根目录/
    );

    // 铁律红线：未命中内存缓存时，穿透拉取真实详情并拦截！杜绝静默越权移除 primaryPath
    await assert.rejects(
      () => service.removeFolder('proj-no-cache', '/opt/repos/primary-root', mockBridge),
      /不能移除项目的主根目录/
    );

    // 负向入参守卫
    await assert.rejects(() => service.addFolder('', '/path', mockBridge), /mandatory/);
    await assert.rejects(() => service.addFolder('proj-10', '', mockBridge), /mandatory/);
    await assert.rejects(() => service.removeFolder('', '/path', mockBridge), /mandatory/);
    await assert.rejects(() => service.removeFolder('proj-10', '', mockBridge), /mandatory/);
  });

  await t.test('4. getProjectTree：获取项目工作区文件树与负向守卫', async () => {
    const service = new ProjectService();
    const mockBridge = {
      async request(method, params) {
        assert.equal(method, 'projects.tree');
        return {
          tree: [
            {
              name: 'src',
              path: '/src',
              isDirectory: true,
              children: [
                { name: 'index.ts', path: '/src/index.ts', isDirectory: false, size: 1024 },
              ],
            },
            { name: 'package.json', path: '/package.json', isDirectory: false, size: 512 },
          ],
        };
      },
    };

    const tree = await service.getProjectTree('proj-1', mockBridge);
    assert.equal(tree.length, 2);
    assert.equal(tree[0].name, 'src');
    assert.equal(tree[0].isDirectory, true);
    assert.equal(tree[0].children?.length, 1);
  });
});

test('RollbackService - 代码时光机快照与还原服务', async (t) => {
  await t.test('1. listVersions 与 getDiff：快照列表、代码差异比对与负向入参校验', async () => {
    const service = new RollbackService();
    const mockBridge = {
      async request(method, params) {
        if (method === 'rollback.list') {
          assert.equal(params.session_id, 'sess-turn-1');
          return {
            checkpoints: [
              {
                hash: 'v-001',
                timestamp: '1000',
                message: '重构 OAuth 回调',
              },
            ],
          };
        }
        if (method === 'rollback.diff') {
          assert.equal(params.hash, 'v-001');
          return {
            diff: '--- a/server.py\n+++ b/server.py\n@@ -10,3 +10,4 @@',
            files_changed: 3,
          };
        }
        throw new Error(`Unexpected call: ${method}`);
      },
    };

    const versions = await service.listVersions('sess-turn-1', mockBridge);
    assert.equal(versions.length, 1);
    assert.equal(versions[0].versionId, 'v-001');

    const diffRes = await service.getDiff('sess-turn-1', 'v-001', mockBridge);
    assert.ok(diffRes.diff?.includes('--- a/server.py'));
    assert.equal(diffRes.files_changed, 3);

    // 负向抛错拦截
    await assert.rejects(() => service.listVersions('', mockBridge), /Session ID is mandatory/);
    await assert.rejects(() => service.getDiff('', 'v-001', mockBridge), /mandatory/);
    await assert.rejects(() => service.getDiff('sess-1', '', mockBridge), /mandatory/);
  });

  await t.test('2. restoreVersion：一键还原工作区代码与负向校验', async () => {
    const service = new RollbackService();
    const mockBridge = {
      async request(method, params) {
        assert.equal(method, 'rollback.restore');
        assert.equal(params.hash, 'v-001');
        return { success: true };
      },
    };

    const restored = await service.restoreVersion('sess-turn-1', 'v-001', mockBridge);
    assert.equal(restored, true);

    // 负向抛错
    await assert.rejects(() => service.restoreVersion('', 'v-001', mockBridge), /Session ID and version ID are mandatory/);
    await assert.rejects(() => service.restoreVersion('sess-1', '', mockBridge), /Session ID and version ID are mandatory/);
  });
});
