/**
 * 专职智能体主工位（Forever Chat）活动同步与物理隔离状态机
 * (packages/core/src/profile/botActivitySync.ts)
 *
 * 【设计意图 (Why)】
 * 专职 Bot 的主工位（Forever Chat）与普通旁聊会话（Session）是相互正交的两个独立实体领域。
 * 抽屉顶部的专职 Bot 卡片（rail-primary-agent-card）展现的时间和副标题，仅且必须代表
 * 该 Bot 本身主工位（Forever Chat）的真实对话状态。
 *
 * 【防范的历史坑 (Pitfall)】
 * 1. 历史上曾经在 syncProfileLastMessages 中越界扫描普通会话池（state.sessions）拿取最新普通会话，
 *    导致用户在专职主工位聊天时，左上角卡片显示着另一个旁聊会话（如“奥特曼反差猫短剧方案 昨天 23:54”）
 *    的时间和文案，造成严重的时间、副标题与内容不一致与闪烁回退；
 * 2. loadMessages 拉取到最新历史后从未回填给 Profile，导致 Bot 卡片一直停留在错误时间；
 * 3. 仅判断 lastMsg.content 导致纯思考链（thought）或工具调用时副标题无法更新；
 * 4. 匹配 Bot 时仅检查 p.name，忽略了 p.displayName 导致别名路由匹配失败；
 * 5. Titlebar 在处于 Bot 工位时因 state.sessions 找不到 hidden=true 的主工位，回退到默认占位文案。
 *
 * 【约束与规则 (Rules)】
 * - 纯函数设计，零 DOM / 零网络依赖，支持全平台共享与 100% 确定性单测；
 * - 严禁在 Bot 卡片中使用普通会话池覆盖；
 * - 必须将数字毫秒时间戳严格规范化，禁止使用未经解析的裸字符串做时间排序。
 */

import type { AgentProfile } from '../rpc/types.js';

export interface BotActivityRecord {
  lastMessage: string;
  timestamp: number;
}

export interface MinimalMessageLike {
  content?: string;
  thought?: string;
  rawTimestamp?: number;
  timestamp?: string | number;
  created_at?: string | number;
}

/**
 * 规范化时间戳为毫秒级数字
 * 支持秒级时间戳（< 1e11）、毫秒级时间戳、ISO 字符串以及非法输入安全兜底
 */
export function normalizeTimestamp(raw: number | string | undefined | null, fallback = Date.now()): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw <= 0) return 0;
    return raw > 1e11 ? raw : raw * 1000;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

/**
 * 消息文本摘要清洗与安全截断
 */
export function cleanMessageSnippet(text: string | undefined | null, maxLen = 100): string {
  if (!text) return '';
  return text.slice(0, maxLen).replace(/\s+/g, ' ').trim();
}

/**
 * 从消息中提取适合作为卡片副标题的纯文本摘要（兼容 content 与 thought）
 */
export function extractMessagePreview(msg: MinimalMessageLike | undefined | null, maxLen = 100): string {
  if (!msg) return '';
  const text = (msg.content && msg.content.trim()) || (msg.thought && msg.thought.trim()) || '';
  return cleanMessageSnippet(text, maxLen);
}

/**
 * 原子性更新指定 Bot 的主工位最新交互状态
 *
 * 【设计意图 (Why)】
 * 统一所有触发源（发消息、流式接收、回合完成、REST 加载、冷启动探测）的收敛更新管道，
 * 保证运行时内存、Profile 模型与自然日格式化文本强一致。
 *
 * 【约束与规则 (Rules)】
 * 必须支持按 name 和 displayName 双向匹配；更新后必须保持按 timestamp 倒序维护 profiles 列表。
 */
export function applyBotActivity(params: {
  profiles: AgentProfile[];
  activityMap: Map<string, BotActivityRecord>;
  botName: string;
  text: string;
  timestamp: number | string;
  formatTime: (ts: number) => string;
}): { updatedProfile?: AgentProfile; profiles: AgentProfile[] } {
  const { profiles, activityMap, botName, text, timestamp, formatTime } = params;
  if (!botName) {
    return { profiles };
  }

  const numTs = normalizeTimestamp(timestamp);
  const cleanText = cleanMessageSnippet(text);

  activityMap.set(botName, {
    lastMessage: cleanText,
    timestamp: numTs,
  });

  const nextProfiles = profiles.map((p) => {
    const matchesName = p.name.toLowerCase() === botName.toLowerCase();
    const matchesDisplay = Boolean(p.displayName && p.displayName.toLowerCase() === botName.toLowerCase());
    if (matchesName || matchesDisplay) {
      return {
        ...p,
        lastMessage: cleanText || p.lastMessage,
        timestamp: numTs,
        lastTime: formatTime(numTs),
      };
    }
    return p;
  });

  nextProfiles.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const updatedProfile = nextProfiles.find(
    (p) => p.name.toLowerCase() === botName.toLowerCase() || (p.displayName && p.displayName.toLowerCase() === botName.toLowerCase())
  );

  return {
    updatedProfile,
    profiles: nextProfiles,
  };
}

/**
 * 智能体副标题与时间联动纯函数（严格物理隔离与单一事实来源）
 *
 * 【约束与规则 (Rules)】
 * 仅且必须来自：
 * 1. 本地最新交互 (activityMap)；
 * 2. Forever Chat 缓存真实历史最后一条消息 (sessionMessagesCache)；
 * 3. 网关原始返回的 last_session 兜底；
 * 4. 若无历史对话则回退至 description，时间为空。
 * 严禁使用普通会话池覆盖！
 */
export function syncBotProfiles(params: {
  profiles: AgentProfile[];
  activityMap: Map<string, BotActivityRecord>;
  foreverChatCache: Map<string, string>;
  sessionMessagesCache: Map<string, MinimalMessageLike[]>;
  formatTime: (ts: number) => string;
}): AgentProfile[] {
  const { profiles, activityMap, foreverChatCache, sessionMessagesCache, formatTime } = params;

  const nextProfiles = profiles.map((p) => {
    // 1. 本地最新交互最高优先
    const localAct = activityMap.get(p.name) || (p.displayName ? activityMap.get(p.displayName) : undefined);
    if (localAct) {
      return {
        ...p,
        lastMessage: localAct.lastMessage,
        timestamp: localAct.timestamp,
        lastTime: formatTime(localAct.timestamp),
      };
    }

    // 2. 探查专职 Bot 终身主工位（Forever Chat）缓存中的真实最新对话
    const foreverChatId = foreverChatCache.get(p.name);
    if (foreverChatId) {
      const cachedMsgs = sessionMessagesCache.get(foreverChatId);
      if (cachedMsgs && cachedMsgs.length > 0) {
        const lastMsg = cachedMsgs[cachedMsgs.length - 1];
        const previewText = extractMessagePreview(lastMsg);
        const rawTs = lastMsg.rawTimestamp ?? lastMsg.timestamp ?? lastMsg.created_at;
        const numTs = normalizeTimestamp(rawTs);
        return {
          ...p,
          lastMessage: previewText || p.lastMessage,
          timestamp: numTs,
          lastTime: formatTime(numTs),
        };
      }
    }

    // 3. 冷启动兜底：从网关原始返回的 last_session 提取
    const lastSess = p.last_session;
    if (lastSess) {
      const preview = cleanMessageSnippet(lastSess.preview || lastSess.title || '');
      const rawActive = lastSess.last_active ?? lastSess.started_at;
      const lastActiveMs = normalizeTimestamp(rawActive, 0);
      return {
        ...p,
        lastMessage: preview || p.lastMessage,
        timestamp: lastActiveMs,
        lastTime: lastActiveMs > 0 ? formatTime(lastActiveMs) : '',
      };
    }

    // 4. 若从未产生过任何对话，副标题使用人设描述，时间清空，严禁拿无关普通会话冒充
    return {
      ...p,
      lastMessage: p.description ? cleanMessageSnippet(p.description) : p.lastMessage,
      lastTime: '',
      timestamp: 0,
    };
  });

  return nextProfiles.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/**
 * 将当前活动会话的最新真实消息与时间反哺给左侧栏对应的卡片实体
 */
export function syncActiveSessionToBot(params: {
  sessionId: string;
  messages: MinimalMessageLike[];
  foreverChatCache: Map<string, string>;
  activeFocusBotName?: string;
  profiles: AgentProfile[];
  activityMap: Map<string, BotActivityRecord>;
  formatTime: (ts: number) => string;
}): { matchedBotName: string | null; updatedText: string; updatedTimestamp: number; profiles: AgentProfile[] } | null {
  const { sessionId, messages, foreverChatCache, activeFocusBotName, profiles, activityMap, formatTime } = params;
  if (!sessionId || messages.length === 0) return null;

  const lastMsg = messages[messages.length - 1];
  const lastText = extractMessagePreview(lastMsg);
  const rawTs = lastMsg.rawTimestamp ?? lastMsg.timestamp ?? lastMsg.created_at;
  const numTs = normalizeTimestamp(rawTs);

  let matchedBotName: string | null = null;
  for (const [botName, fId] of foreverChatCache.entries()) {
    if (fId === sessionId) {
      matchedBotName = botName;
      break;
    }
  }
  if (!matchedBotName && activeFocusBotName) {
    matchedBotName = activeFocusBotName;
  }

  if (matchedBotName) {
    const res = applyBotActivity({
      profiles,
      activityMap,
      botName: matchedBotName,
      text: lastText,
      timestamp: numTs,
      formatTime,
    });
    return {
      matchedBotName,
      updatedText: lastText,
      updatedTimestamp: numTs,
      profiles: res.profiles,
    };
  }

  return null;
}

/**
 * 顶栏标题根据当前互斥焦点精准解析纯函数（PR-3e 订正：移除 🤖 与 (Forever Chat) 冗余）。
 * 设计意图 (Why)：顶栏标题只承担当前聚焦实体或会话的权威命名，视觉上由专用头像组件承载身份，文字不再夹带假 emoji；
 * 防范的历史坑 (Pitfall)：曾硬编码 `🤖 ${name} (Forever Chat)` 导致标题冗长臃肿且与桌面端标题栏原生视觉割裂；
 * 约束与规则 (Rules)：专职智能体返回其 displayName/name；群聊返回群名；会话返回会话标题；未连接返回 notConnectedTitle。
 */
export function resolveTitlebarTitle(params: {
  activeFocus?: { type: 'bot'; botName: string } | { type: 'session'; sessionId: string } | { type: 'group'; roomId: string };
  profiles: AgentProfile[];
  groupRooms?: Array<{ roomId: string; name: string }>;
  sessions?: Array<{ id: string; title: string }>;
  activeSessionId?: string;
  defaultTitle: string;
  notConnectedTitle: string;
  defaultRoomName: string;
  isConnected: boolean;
  profileName?: string;
}): string {
  const {
    activeFocus,
    profiles,
    groupRooms = [],
    sessions = [],
    activeSessionId,
    defaultTitle,
    notConnectedTitle,
    defaultRoomName,
    isConnected,
    profileName,
  } = params;

  if (activeFocus?.type === 'bot') {
    const focusBot = profiles.find(
      (p) =>
        p.name.toLowerCase() === activeFocus.botName.toLowerCase() ||
        (p.displayName && p.displayName.toLowerCase() === activeFocus.botName.toLowerCase())
    );
    const botDisplay = focusBot?.displayName || activeFocus.botName;
    return botDisplay;
  }

  if (activeFocus?.type === 'group') {
    const focusGroup = groupRooms.find((g) => g.roomId === activeFocus.roomId);
    return `👥 ${focusGroup?.name || defaultRoomName}`;
  }

  if (activeSessionId) {
    const activeSession = sessions.find((s) => s.id === activeSessionId);
    if (activeSession) {
      const rawTitle = activeSession.title;
      return rawTitle === 'Bot Chat' ? (profileName || 'default') : rawTitle;
    }
  }

  return isConnected ? defaultTitle : notConnectedTitle;
}

/**
 * 顶栏当前激活实体头像解析纯函数（PR-3e）。
 * 设计意图 (Why)：当焦点处于专职智能体（type === 'bot'）或当前会话属于专职 Bot 时，顶栏需要渲染该 Bot 的真实头像；
 * 防范的历史坑 (Pitfall)：历史版本在标题文字中内嵌假 emoji 🤖 假冒头像，违背零假冒工程哲学且破坏排版；
 * 约束与规则 (Rules)：纯函数无副作用，找不到匹配 profile 时安全降级返回 undefined。
 */
export function resolveTitlebarAvatar(params: {
  activeFocus?: { type: 'bot'; botName: string } | { type: 'session'; sessionId: string } | { type: 'group'; roomId: string };
  profiles: AgentProfile[];
  profileName?: string;
  activeSessionId?: string;
  sessions?: Array<{ id: string; title: string; botName?: string }>;
}): { avatar?: string; name: string } | undefined {
  const { activeFocus, profiles, profileName, activeSessionId, sessions = [] } = params;
  let targetName: string | undefined;

  if (activeFocus?.type === 'bot') {
    targetName = activeFocus.botName;
  } else if (activeSessionId) {
    const activeSession = sessions.find((s) => s.id === activeSessionId);
    if (activeSession && (activeSession.title === 'Bot Chat' || activeSession.botName)) {
      targetName = activeSession.botName || profileName || 'default';
    }
  }

  if (!targetName) return undefined;

  const found = profiles.find(
    (p) =>
      p.name.toLowerCase() === targetName!.toLowerCase() ||
      (p.displayName && p.displayName.toLowerCase() === targetName!.toLowerCase())
  );

  return {
    avatar: found?.avatar,
    name: found?.displayName || targetName,
  };
}
