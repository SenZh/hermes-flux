/**
 * React 对话区挂载桥
 *
 * 设计意图(Why)：
 *   与左轨同构：宿主只挂一次 createRoot，之后只推 props；宿主节点绝不被 innerHTML/outerHTML 覆写。
 *
 * 防范的历史坑(Pitfall)：
 *   模板时代每帧替换宿主 outerHTML，导致滚动位置、折叠状态与输入焦点被重建。
 *
 * 约束与规则(Rules)：
 *   1. 挂载前宿主必须已连接；
 *   2. 同一宿主只允许一个 root；
 *   3. 全量 render 路径不得触碰该宿主。
 */

import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConversationStage } from './ConversationStage.js';
import { ConversationMessageList } from './ConversationMessageList.js';
import { PromptNavigatorRail } from './PromptNavigatorRail.js';
import type { ConversationActions, ConversationSnapshot } from './types.js';
import type { PromptNavigatorActions, PromptNavigatorSnapshot } from '../../lib/promptNavigator.js';

export interface ConversationMount {
  update: () => void;
  unmount: () => void;
}

export function mountConversation(
  host: HTMLElement,
  getSnapshot: () => ConversationSnapshot,
  options: { actions?: ConversationActions; onboarding?: () => ReactNode; dock?: () => ReactNode } = {}
): ConversationMount {
  if (!host.isConnected) throw new Error('Conversation host must be connected before mounting');
  const root: Root = createRoot(host);

  const update = (): void => {
    root.render(
      <ConversationStage
        snapshot={getSnapshot()}
        actions={options.actions}
        onboarding={options.onboarding?.()}
        dock={options.dock?.()}
      />
    );
  };

  update();
  return {
    update,
    unmount: () => root.unmount(),
  };
}

/**
 * 提示词导航轨挂载：只接管轨道，pod / 滚动容器 / 输入舱仍由宿主模板提供。
 *
 * 【设计意图 (Why)】
 *   轨道必须挂在 `.flux-middle-pod` 的常驻 host 上，与标题栏、左轨、消息列表同构：
 *   宿主只推快照，组件内部状态（高亮、面板、轮播）不会因为一次 render 被重建。
 *
 * 【防范的历史坑 (Pitfall)】
 *   挂进 `#conversation-stream` 会在 `activeStream.innerHTML = renderConversationCanvas(...)`
 *   时连宿主一起销毁，轨道从此不再出现。
 *
 * 【约束与规则 (Rules)】同一 host 只允许一个 root；宿主要求已连接。
 */
export function mountPromptNavigator(
  host: HTMLElement,
  getSnapshot: () => PromptNavigatorSnapshot,
  actions: PromptNavigatorActions
): ConversationMount {
  if (!host.isConnected) throw new Error('Prompt navigator host must be connected before mounting');
  const root: Root = createRoot(host);

  const update = (): void => {
    root.render(<PromptNavigatorRail snapshot={getSnapshot()} actions={actions} />);
  };

  update();
  return {
    update,
    unmount: () => root.unmount(),
  };
}

/**
 * 嵌入式消息列表挂载：只接管列表，main / 滚动容器 / 输入舱仍由宿主模板提供。
 */
export function mountMessageList(
  host: HTMLElement,
  getSnapshot: () => ConversationSnapshot
): ConversationMount {
  if (!host.isConnected) throw new Error('Message list host must be connected before mounting');
  const root: Root = createRoot(host);

  const update = (): void => {
    root.render(<ConversationMessageList snapshot={getSnapshot()} />);
  };

  update();
  return {
    update,
    unmount: () => root.unmount(),
  };
}
