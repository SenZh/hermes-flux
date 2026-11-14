/**
 * Hermes Flux 项目树管理与会话归属服务（Project Operation Service）
 *
 * 【设计意图 (Why)】
 *   将工程项目列表拉取、官方契约与 raw 接口兼容解析、项目与会话关联判定、
 *   以及专职智能体主工位与最新动态同步（syncProfileLastMessages）彻底从 index.ts 中解耦。
 *   使项目树生命周期与实体领域逻辑能够脱离宿主 DOM 运行，具备可单测性与单向依赖纯度。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. Failure Is Not Empty：网络或网关故障时绝不可将 state.projects 抹杀为空数组伪装成没有项目，
 *      必须保留上一轮拉取到的有效项目列表或提示错误，严禁静默覆盖为权威空；
 *   2. 历史上曾经在扫描普通会话池（state.sessions）拿取最新普通会话覆盖 Bot 卡片，
 *      导致用户在专职主工位聊天时，左上角卡片显示着另一个旁聊会话的时间和文案；
 *      因此 syncProfileLastMessages 必须仅且必须依据专职 Bot 本身主工位（Forever Chat）与活动记录同步；
 *   3. 官方契约容错兜底：若 ProjectService.listProjects 返回空，必须兜底尝试无参 projects.list，
 *      吸收不同版本网关在 projects 字段与 data 字段上的包装差异。
 *
 * 【约束与规则 (Rules)】
 *   1. 单向依赖：严禁反向 import index.js，所有外部状态读写与 UI 渲染通过 ProjectOperationDeps 注入；
 *   2. 严格类型约束：0 TS 报错，严禁使用 `as any`；
 *   3. 零文本写死：异常日志与提示保持标准格式。
 */

import type { AppState } from '../state/appState.js';
import {
  type HermesGatewayClient,
  type ProjectSummary,
  ProjectService,
  syncBotProfiles,
} from '@hermes-flux/core';
import type { MessageViewModel } from '@hermes-flux/ui';
import type { BotActivityStore } from '../persistence/botActivityStore.js';

export interface ProjectRawRecord {
  id?: string;
  projectId?: string;
  name?: string;
  slug?: string;
  primary_path?: string;
  primaryPath?: string;
  path?: string;
}

export interface ProjectsListResponse {
  projects?: ProjectRawRecord[];
  data?: ProjectRawRecord[];
}

export interface ProjectOperationDeps {
  readonly getState: () => AppState;
  readonly getGatewayClient: () => HermesGatewayClient | null;
  readonly render: () => void;
  readonly botActivityStore: BotActivityStore;
  readonly botForeverChatCache: Map<string, string>;
  readonly sessionMessagesCache: Map<string, MessageViewModel[]>;
  readonly formatSessionTime: (timestamp: number) => string;
}

export interface ProjectOperationService {
  fetchProjects(): Promise<void>;
  syncProfileLastMessages(): void;
  getProjectService(): ProjectService;
}

export function createProjectOperationService(deps: ProjectOperationDeps): ProjectOperationService {
  const projectService = new ProjectService();

  function syncProfileLastMessages(): void {
    const state = deps.getState();
    deps.botActivityStore.withActivityMap((activityMap) => {
      state.profiles = syncBotProfiles({
        profiles: state.profiles,
        activityMap,
        foreverChatCache: deps.botForeverChatCache,
        sessionMessagesCache: deps.sessionMessagesCache,
        formatTime: deps.formatSessionTime,
      });
    });
  }

  async function fetchProjects(): Promise<void> {
    const client = deps.getGatewayClient();
    if (!client) return;
    const state = deps.getState();
    try {
      let authoritative = false;
      let summaries: ProjectSummary[] = [];

      try {
        summaries = await projectService.listProjects(client, true);
        authoritative = true;
      } catch {
        // 容错兜底：若 Service 解析失败，尝试无参 raw 契约解析
        const rawRes = await client.call<ProjectsListResponse>('projects.list', {});
        authoritative = true;
        const rawList = Array.isArray(rawRes?.projects)
          ? rawRes.projects
          : Array.isArray(rawRes?.data)
          ? rawRes.data
          : [];
        summaries = rawList.map((p) => ({
          projectId: String(p.id || p.projectId || ''),
          name: String(p.name || p.id || 'Project'),
          slug: String(p.slug || p.name || p.id || 'project'),
          primaryPath: String(p.primary_path || p.primaryPath || p.path || ''),
          additionalFolders: [],
          isActive: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }));
      }

      if (authoritative) {
        state.projects = summaries.map((s) => ({
          id: s.projectId,
          name: s.name,
          path: s.primaryPath,
        }));
      }

      deps.render();
    } catch (e) {
      // Failure Is Not Empty: 网络或网关故障时绝不可将 state.projects 抹杀为空数组伪装成没有项目
      console.warn('[Flux] fetchProjects failed:', e);
      // 保留上一次已拉取到的项目列表或提示错误，严禁静默覆盖为权威空
      deps.render();
    }
  }

  return {
    fetchProjects,
    syncProfileLastMessages,
    getProjectService: () => projectService,
  };
}
