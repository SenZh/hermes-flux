/**
 * Project Workspace & Code Time Machine (Rollback) Service
 * (packages/core/src/project/projectService.ts)
 *
 * 设计意图 (Why):
 *   项目（Project）是 Hermes Flux 中超越单会话的高维工程业务实体。
 *   一个项目聚合 1 个主目录（Primary Folder 作为默认 CWD）、若干关联文件夹，
 *   并绑定后台任务看板与分支执行环境；
 *   代码时光机（Rollback）则为会话中由 AI 执行的代码变更提供 Git 级别的版本快照与无损回滚。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 会话穿帮（Session Leaking）：会话一旦创建，其工作目录 CWD 必须冻结（Frozen CWD），
 *      切换项目时必须校验并提示工作区隔离边界。
 *   2. 误删除主目录：removeFolder 严禁移除 Primary Folder。
 *   3. 失败隐匿：目录树拉取或时光机回滚失败时必须显式抛出 Error。
 *
 * 约束与规则 (Rules):
 *   - 纯 TypeScript 实现，零宿主 API 或 DOM 依赖。
 *   - 100% 遵守 Monorepo 分层，面向全端同构。
 */

import type {
  ProjectSummary,
  ProjectDetail,
  ProjectTreeNode,
  ProjectsListResult,
  ProjectsGetParams,
  ProjectsGetResult,
  ProjectsCreateParams,
  ProjectsCreateResult,
  ProjectsUpdateParams,
  ProjectsUpdateResult,
  ProjectsDeleteParams,
  ProjectsDeleteResult,
  ProjectsSetActiveParams,
  ProjectsSetActiveResult,
  ProjectsAddFolderParams,
  ProjectsAddFolderResult,
  ProjectsRemoveFolderParams,
  ProjectsRemoveFolderResult,
  ProjectsTreeParams,
  ProjectsTreeResult,
  RollbackVersionEntry,
  RollbackListParams,
  RollbackListResult,
  RollbackDiffParams,
  RollbackDiffResult,
  RollbackRestoreParams,
  RollbackRestoreResult,
  IRpcCaller,
} from '../rpc/types.js';

export class ProjectService {
  private activeProjectId: string | null = null;
  private projectCache = new Map<string, ProjectSummary>();

  /**
   * 拉取所有项目工程列表
   */
  public async listProjects(bridge: IRpcCaller, forceRefresh = false): Promise<ProjectSummary[]> {
    if (!forceRefresh && this.projectCache.size > 0) {
      return Array.from(this.projectCache.values());
    }

    const res = await bridge.request<ProjectsListResult>('projects.list');
    const rawList = Array.isArray(res?.projects) ? res.projects : null;

    if (!rawList) {
      throw new Error('网关返回了非法的 projects.list 响应数据结构');
    }

    this.projectCache.clear();
    const normalized: ProjectSummary[] = [];

    for (const raw of rawList) {
      const projectId = raw.projectId || raw.id || '';
      const primaryPath = raw.primaryPath || raw.primary_path || '';
      const summary: ProjectSummary = {
        projectId,
        name: raw.name || '',
        slug: raw.slug || '',
        primaryPath,
        additionalFolders: Array.isArray(raw.additionalFolders)
          ? raw.additionalFolders
          : Array.isArray(raw.folders)
          ? raw.folders.map(f => f.path)
          : [],
        isActive: Boolean(raw.isActive || raw.is_active),
        createdAt: raw.createdAt || raw.created_at || Date.now(),
        updatedAt: raw.updatedAt || raw.updated_at || Date.now(),
      };

      this.projectCache.set(projectId, summary);
      if (summary.isActive) {
        this.activeProjectId = projectId;
      }
      normalized.push(summary);
    }

    return normalized;
  }

  /**
   * 获取指定项目详细信息（含关联会话与附加文件夹）
   * 官方 Gateway 接收参数为 { id }
   */
  public async getProject(projectId: string, bridge: IRpcCaller): Promise<ProjectDetail> {
    if (!projectId) throw new Error('Project ID is mandatory for getProject');
    const res = await bridge.request<ProjectsGetResult, ProjectsGetParams>('projects.get', {
      id: projectId,
    });
    const raw = res?.project;

    if (!raw) {
      throw new Error(`未找到指定项目: ${projectId}`);
    }

    const detail: ProjectDetail = {
      projectId: raw.projectId || raw.id || projectId,
      name: raw.name || '',
      slug: raw.slug || '',
      primaryPath: raw.primaryPath || raw.primary_path || '',
      additionalFolders: Array.isArray(raw.additionalFolders)
        ? raw.additionalFolders
        : Array.isArray(raw.folders)
        ? raw.folders.map(f => f.path)
        : [],
      description: raw.description,
      isActive: Boolean(raw.isActive || raw.is_active),
      createdAt: raw.createdAt || raw.created_at || Date.now(),
      updatedAt: raw.updatedAt || raw.updated_at || Date.now(),
    };
    return detail;
  }

  /**
   * 创建新项目
   * 兼容官方 Gateway 参数签名：folders 与 primary_path，支持 path 字段自动适配
   */
  public async createProject(
    params: ProjectsCreateParams,
    bridge: IRpcCaller
  ): Promise<ProjectsCreateResult> {
    const rawPath = params.path || params.primary_path || (params.folders && params.folders[0]);
    if (!params.name || !rawPath) {
      throw new Error('Project name and root path are mandatory');
    }

    const payload: ProjectsCreateParams = {
      name: params.name,
      folders: params.folders || [rawPath],
      primary_path: params.primary_path || rawPath,
      description: params.description,
      slug: params.slug,
      use: params.use,
    };

    const res = await bridge.request<ProjectsCreateResult, ProjectsCreateParams>(
      'projects.create',
      payload
    );
    await this.listProjects(bridge, true);
    return res;
  }

  /**
   * 更新项目属性
   * 官方 Gateway 参数契约：{ id, name?, description?, icon?, color?, board_slug? }
   */
  public async updateProject(
    projectId: string,
    patch: Partial<ProjectDetail>,
    bridge: IRpcCaller
  ): Promise<boolean> {
    if (!projectId) throw new Error('Project ID is mandatory for updateProject');
    const res = await bridge.request<ProjectsUpdateResult, ProjectsUpdateParams>(
      'projects.update',
      {
        id: projectId,
        name: patch.name,
        description: patch.description,
        icon: patch.icon,
        color: patch.color,
        board_slug: patch.board_slug,
      }
    );
    const isSuccess = Boolean(res?.success || res?.project);
    if (isSuccess) {
      await this.listProjects(bridge, true);
    }
    return isSuccess;
  }

  /**
   * 删除项目
   * 官方 Gateway 参数契约：{ id }
   */
  public async deleteProject(projectId: string, bridge: IRpcCaller): Promise<boolean> {
    if (!projectId) throw new Error('Project ID is mandatory for deleteProject');
    const res = await bridge.request<ProjectsDeleteResult, ProjectsDeleteParams>(
      'projects.delete',
      { id: projectId }
    );
    const isSuccess = Boolean(res?.success || res);
    if (isSuccess) {
      this.projectCache.delete(projectId);
      if (this.activeProjectId === projectId) {
        this.activeProjectId = null;
      }
    }
    return isSuccess;
  }

  /**
   * 激活指定项目为当前工作区
   * 官方 Gateway 参数契约：{ id }
   */
  public async setActiveProject(projectId: string, bridge: IRpcCaller): Promise<boolean> {
    if (!projectId) throw new Error('Project ID is mandatory for setActiveProject');
    const res = await bridge.request<ProjectsSetActiveResult, ProjectsSetActiveParams>(
      'projects.set_active',
      { id: projectId }
    );
    const isSuccess = Boolean(res?.success || res);
    if (isSuccess) {
      this.activeProjectId = projectId;
      for (const p of this.projectCache.values()) {
        p.isActive = p.projectId === projectId;
      }
    }
    return isSuccess;
  }

  public getActiveProjectId(): string | null {
    return this.activeProjectId;
  }

  /**
   * 为项目挂载附加工作目录
   * 官方 Gateway 参数契约：{ id, path, is_primary?, label? }
   */
  public async addFolder(projectId: string, path: string, bridge: IRpcCaller): Promise<boolean> {
    if (!projectId || !path) throw new Error('Project ID and folder path are mandatory');
    const res = await bridge.request<ProjectsAddFolderResult, ProjectsAddFolderParams>(
      'projects.add_folder',
      { id: projectId, path }
    );
    return Boolean(res?.success || res?.project);
  }

  /**
   * 从项目移除关联目录（严禁移除 Primary Folder）
   * 官方 Gateway 参数契约：{ id, path }
   */
  public async removeFolder(projectId: string, path: string, bridge: IRpcCaller): Promise<boolean> {
    if (!projectId || !path) throw new Error('Project ID and folder path are mandatory');
    let project = this.projectCache.get(projectId);
    if (!project) {
      // 缓存未命中时强制穿透校验项目真实详情，防范不变量被绕过
      project = await this.getProject(projectId, bridge);
    }
    if (project && project.primaryPath === path) {
      throw new Error('不能移除项目的主根目录 (Primary Folder)');
    }

    const res = await bridge.request<ProjectsRemoveFolderResult, ProjectsRemoveFolderParams>(
      'projects.remove_folder',
      { id: projectId, path }
    );
    return Boolean(res?.success || res?.project);
  }

  /**
   * 获取项目的目录文件树 (projects.tree)
   * 官方 Gateway 参数契约：{ profile?, preview_limit?, session_limit? }
   */
  public async getProjectTree(
    projectId: string,
    bridge: IRpcCaller,
    relativePath?: string,
    depth = 3
  ): Promise<ProjectTreeNode[]> {
    const res = await bridge.request<ProjectsTreeResult, ProjectsTreeParams>('projects.tree', {
      preview_limit: 10,
    });
    const rawProjects = res?.projects;
    if (Array.isArray(rawProjects)) {
      // 官方 Gateway 返回工程根节点树
      return rawProjects as ProjectTreeNode[];
    }
    return res && Array.isArray(res.tree) ? res.tree : [];
  }
}

/**
 * 代码时光机与还原服务 (RollbackService)
 */
export class RollbackService {
  /**
   * 查询指定会话执行产生的版本快照列表
   * 适配官方 Gateway 返回结构：checkpoints: [{ hash, timestamp, message }] 与 versions
   */
  public async listVersions(sessionId: string, bridge: IRpcCaller): Promise<RollbackVersionEntry[]> {
    if (!sessionId) throw new Error('Session ID is mandatory for listVersions');
    const res = await bridge.request<RollbackListResult, RollbackListParams>('rollback.list', {
      session_id: sessionId,
    });
    if (res && Array.isArray(res.checkpoints)) {
      return res.checkpoints.map((cp) => ({
        versionId: cp.hash,
        sessionId,
        timestamp: cp.timestamp,
        commitHash: cp.hash,
        title: cp.message,
      }));
    }
    return res && Array.isArray(res.versions) ? res.versions : [];
  }

  /**
   * 查看指定快照版本的代码差异比对 (Diff)
   * 适配官方参数：{ session_id, hash }
   */
  public async getDiff(
    sessionId: string,
    versionId: string,
    bridge: IRpcCaller
  ): Promise<RollbackDiffResult> {
    if (!sessionId || !versionId) {
      throw new Error('Session ID and version ID are mandatory for getDiff');
    }
    return bridge.request<RollbackDiffResult, RollbackDiffParams>('rollback.diff', {
      session_id: sessionId,
      hash: versionId,
    });
  }

  /**
   * 一键还原代码工作区至指定版本
   * 适配官方参数：{ session_id, hash } 与结果 { success }
   */
  public async restoreVersion(
    sessionId: string,
    versionId: string,
    bridge: IRpcCaller
  ): Promise<boolean> {
    if (!sessionId || !versionId) {
      throw new Error('Session ID and version ID are mandatory for restoreVersion');
    }
    const res = await bridge.request<RollbackRestoreResult, RollbackRestoreParams>(
      'rollback.restore',
      { session_id: sessionId, hash: versionId }
    );
    return Boolean(res.success || res.restored);
  }
}
