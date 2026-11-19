/**
 * 对话区列宽档位（Conversation Width Mode）的唯一真值表与本地偏好。
 *
 * 设计意图(Why)：
 *   对话区列宽（窄 / 较宽 / 全宽）需要在设置页选项、宿主状态与 CSS 变量之间保持一致。
 *   将枚举、宽度 Token 映射、白名单收敛与持久化集中在 tokens 层，避免组件与宿主各自硬编码。
 *
 * 防范的历史坑(Pitfall)：
 *   1. localStorage 在隐私模式下读写会抛错，必须降级为默认值而不是阻塞启动；
 *   2. 脏数据（手改 localStorage / 旧版本残留）不得直接写入 data-chat-layout 或 CSS 变量，
 *      否则样式匹配失效会导致画布宽度不可控；
 *   3. .conversation-pod 局部作用域定义了 --conv-column-max，因此需同时写入
 *      data-chat-layout 与 --chat-column-max 变量，确保从 :root 继承到画布层始终生效。
 *
 * 约束与规则(Rules)：
 *   1. 存储键统一使用 hermes_flux_* 前缀，与其它外观偏好保持一致；
 *   2. 非法、空值一律收敛为 DEFAULT_CONVERSATION_WIDTH_MODE（'wide'）；
 *   3. 本文件零 React 依赖，可被单测在 Node 环境直接导入验证。
 */

export const CONVERSATION_WIDTH_MODES = ['narrow', 'wide', 'full'] as const;

export type ConversationWidthMode = (typeof CONVERSATION_WIDTH_MODES)[number];

export const DEFAULT_CONVERSATION_WIDTH_MODE: ConversationWidthMode = 'wide';

export const CONVERSATION_WIDTH_STORAGE_KEY = 'hermes_flux_conversation_width';

export const CONVERSATION_WIDTH_TOKENS: Record<ConversationWidthMode, string> = {
  narrow: '48rem',
  wide: '72rem',
  full: '100%',
};

const WIDTH_MODE_SET = new Set<string>(CONVERSATION_WIDTH_MODES);

/** 应用对话区宽度所需的最小 DOM 根接口（不依赖完整 HTMLElement）。 */
export type ConversationWidthRootTarget = { setAttribute(name: string, value: string): void; style: { setProperty(name: string, value: string): void } };

/**
 * 把任意输入收敛为合法的对话区宽度档位。
 * 【规则】未知值、空值、非字符串一律回落到默认值（'wide'）。
 */
export function resolveConversationWidthMode(value: string | null | undefined): ConversationWidthMode {
  // SAFETY: [narrowed-by] WIDTH_MODE_SET.has() 已证明该字符串是宽度档位真值表成员
  return typeof value === 'string' && WIDTH_MODE_SET.has(value)
    ? (value as ConversationWidthMode)
    : DEFAULT_CONVERSATION_WIDTH_MODE;
}

export function loadConversationWidthMode(): ConversationWidthMode {
  let raw: string | null = null;
  try {
    raw = typeof localStorage === 'undefined'
      ? null
      : localStorage.getItem(CONVERSATION_WIDTH_STORAGE_KEY);
  // gate-degrade: 隐私模式下读取 localStorage 会抛错，缺失偏好回落默认值属可选增强失败
  } catch {
    raw = null;
  }
  return resolveConversationWidthMode(raw);
}

export function saveConversationWidthMode(mode: ConversationWidthMode): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CONVERSATION_WIDTH_STORAGE_KEY, resolveConversationWidthMode(mode));
    }
  // gate-degrade: 写入失败时偏好只在本次会话生效，不阻断界面
  } catch {
    // 写入失败不影响当前渲染
  }
}

export function applyConversationWidthMode(mode: ConversationWidthMode | string | null | undefined, root: ConversationWidthRootTarget | null = typeof document === 'undefined' ? null : document.documentElement): ConversationWidthMode {
  const resolved = resolveConversationWidthMode(mode);
  if (!root) return resolved;
  root.setAttribute('data-chat-layout', resolved);
  root.style.setProperty('--chat-column-max', CONVERSATION_WIDTH_TOKENS[resolved]);
  return resolved;
}
