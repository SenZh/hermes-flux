/**
 * Hermes Flux Standardized i18n Architecture (OpenChamber Parity)
 * Flat key dictionary with compile-time parity validation.
 */

export const zhDict = {
  // Titlebar & Window
  'titlebar.defaultTitle': 'Hermes Flux — 请选择或新建会话',
  'titlebar.notConnected': '未连接网关',
  'titlebar.toggleLeftRail': '折叠/展开侧栏 (Ctrl+B)',
  'titlebar.toggleInspector': '折叠/展开检查舱 (Ctrl+\\)',
  'titlebar.settings': '系统设置',

  // Left Rail
  'rail.newChat': '新建会话',
  'rail.searchPlaceholder': '搜索历史会话...',
  'rail.conversations': '对话列表',
  'rail.archived': '归档会话',
  'rail.emptyTitle': '暂无历史会话',
  'rail.emptySub': '点击上方按钮开启全新会话任务',
  'rail.errorTitle': '暂时无法显示历史会话',
  'rail.errorSub': '请检查网关连接后重试',

  // Middle Pod & Timeline
  'chat.welcomeTitle': 'Hermes Flux 工作台已就绪',
  'chat.welcomeSub': '在下方 740px 黄金限宽输入舱下达任务，按 Enter 发送。Hermes 将自主规划多步骤推理、调用工具链并流式呈现。',
  'chat.gatewayConnecting': '正在连接 Hermes 网关...',
  'chat.reasoning': '推理',
  'chat.tool': 'Tool Call',
  'chat.shellCommand': 'Shell Command',
  'chat.readFile': 'Read File',
  'chat.writeFile': 'Write File',
  'chat.editFile': 'Edit File',
  'chat.searchFiles': 'Search Files',
  'chat.findFiles': 'Find Files',
  'chat.agentTask': 'Agent Task',
  'chat.loadOlder': '↑ 向上滚动查看更早历史',
  'chat.loadingOlder': '正在加载更早历史...',

  // Input Dock
  'dock.placeholder': '给 Hermes 下达任务... (Enter 发送, Shift+Enter 换行)',
  'dock.placeholderDisabled': '请先连接网关...',
  'dock.selectModel': '选择模型',
  'dock.searchModel': '搜索模型',
  'dock.addProvider': '添加新提供商',
  'dock.refresh': '刷新 ↻',
  'dock.favorites': '收藏',
  'dock.recents': '最近',
  'dock.reasoning': '思考',
  'dock.approval': '权限审批',
  'dock.approvalAuto': '自动',
  'dock.approvalAsk': '询问',
  'dock.approvalSandbox': '沙箱',
  'dock.send': '发送 (Enter)',
  'dock.stop': '中断本轮生成',

  // Inspector
  'inspector.filePreview': '文件预览',
  'inspector.noFile': '暂无正在预览的文件',
  'inspector.noFileSub': '点击对话流中的文件路径或工具执行结果，即可在此处实时查看文件代码与改动',
  'inspector.copy': '复制',
  'inspector.noOpenFiles': '暂无打开的文件',
  'inspector.enterFullscreen': '全屏预览文件',
  'inspector.exitFullscreen': '退出全屏预览 (Esc)',
  'inspector.collapse': '折叠右侧栏 (Ctrl+\\)',
  'inspector.searchPlaceholder': '在当前文件中搜索...',
  'inspector.closeSearch': '关闭搜索',
  'inspector.viewRaw': '切换为纯文本源码 (Raw)',
  'inspector.viewRendered': '切换为富渲染视图 (Rendered)',
  'inspector.findInFile': '文件内查找 (Ctrl+F)',
  'inspector.showLineNumbers': '显示行号',
  'inspector.hideLineNumbers': '隐藏行号',
  'inspector.openExternal': '在默认应用中打开',
  'inspector.copyContent': '复制文件全部内容',
  'inspector.copyPath': '复制文件路径',
  'inspector.download': '保存/另存为本地文件',
  'inspector.closeTab': '关闭标签页',
  'inspector.tabFiles': '文件',
  'inspector.tabGit': '变动',
  'inspector.tabBrowser': '浏览器',
  'inspector.tabMemory': '记忆',
  'inspector.gitEmpty': '暂无 Git 工作区变动',
  'inspector.gitEmptySub': '代码改动或提交差异将在此处流式聚合',
  'inspector.browserEmpty': '暂无活动浏览器视口',
  'inspector.browserEmptySub': 'Agent 执行 Web 自动化与截图交互时将在此投射',
  'inspector.browserWaiting': '正在等待视口推流...',
  'inspector.memoryEmpty': '暂无沉淀的认知记忆',
  'inspector.memoryEmptySub': 'Hermes 在长期交互中沉淀的用户偏好与工程暗知识将收录于此',
  'inspector.resizeHandleTitle': '拖拽调整右侧栏宽度 · 双击复位',
  'inspector.remoteNotice': '该文件位于远程网关工作区，网关未开放直接文件读取通道',
  'inspector.loadingNotice': '正在从工作区加载最新版本内容...',

  // Status Bar
  'status.connected': '已连接',
  'status.connecting': '连接中...',
  'status.disconnected': '未连接',
} as const;

export type I18nKey = keyof typeof zhDict;

export const enDict: Record<I18nKey, string> = {
  'titlebar.defaultTitle': 'Hermes Flux — Select or create a session',
  'titlebar.notConnected': 'Gateway Disconnected',
  'titlebar.toggleLeftRail': 'Toggle Left Rail (Ctrl+B)',
  'titlebar.toggleInspector': 'Toggle Inspector Pod (Ctrl+\\)',
  'titlebar.settings': 'System Settings',

  'rail.newChat': 'New Session',
  'rail.searchPlaceholder': 'Search sessions...',
  'rail.conversations': 'Conversations',
  'rail.archived': 'Archived Sessions',
  'rail.emptyTitle': 'No Conversation History',
  'rail.emptySub': 'Click the button above to begin a new task',
  'rail.errorTitle': 'Failed to Load Sessions',
  'rail.errorSub': 'Please check gateway connection and retry',

  'chat.welcomeTitle': 'Hermes Flux Workspace Ready',
  'chat.welcomeSub': 'Dispatch goals in the golden 740px dock below. Hermes will plan reasoning steps, invoke toolchains, and stream progress.',
  'chat.gatewayConnecting': 'Connecting to Hermes Gateway...',
  'chat.reasoning': 'Reasoning',
  'chat.tool': 'Tool Call',
  'chat.shellCommand': 'Shell Command',
  'chat.readFile': 'Read File',
  'chat.writeFile': 'Write File',
  'chat.editFile': 'Edit File',
  'chat.searchFiles': 'Search Files',
  'chat.findFiles': 'Find Files',
  'chat.agentTask': 'Agent Task',
  'chat.loadOlder': '↑ Scroll up to load earlier history',
  'chat.loadingOlder': 'Loading earlier history...',

  'dock.placeholder': 'Dispatch tasks to Hermes... (Enter to send, Shift+Enter for new line)',
  'dock.placeholderDisabled': 'Connect to gateway first...',
  'dock.selectModel': 'Select Model',
  'dock.searchModel': 'Search models...',
  'dock.addProvider': 'Add New Provider',
  'dock.refresh': 'Refresh ↻',
  'dock.favorites': 'Favorites',
  'dock.recents': 'Recents',
  'dock.reasoning': 'Thinking',
  'dock.approval': 'Approval',
  'dock.approvalAuto': 'Auto',
  'dock.approvalAsk': 'Ask',
  'dock.approvalSandbox': 'Sandbox',
  'dock.send': 'Send (Enter)',
  'dock.stop': 'Stop Turn Generation',

  'inspector.filePreview': 'File Preview',
  'inspector.noFile': 'No Inspected File',
  'inspector.noFileSub': 'Click file paths or tool artifacts in conversation stream to inspect source and diffs here',
  'inspector.copy': 'Copy',
  'inspector.noOpenFiles': 'No open files',
  'inspector.enterFullscreen': 'Fullscreen preview',
  'inspector.exitFullscreen': 'Exit fullscreen (Esc)',
  'inspector.collapse': 'Collapse inspector (Ctrl+\\)',
  'inspector.searchPlaceholder': 'Find in current file...',
  'inspector.closeSearch': 'Close search',
  'inspector.viewRaw': 'Switch to Raw Code',
  'inspector.viewRendered': 'Switch to Rendered View',
  'inspector.findInFile': 'Find in file (Ctrl+F)',
  'inspector.showLineNumbers': 'Show line numbers',
  'inspector.hideLineNumbers': 'Hide line numbers',
  'inspector.openExternal': 'Open in Default App',
  'inspector.copyContent': 'Copy entire file content',
  'inspector.copyPath': 'Copy file path',
  'inspector.download': 'Save file locally',
  'inspector.closeTab': 'Close tab',
  'inspector.tabFiles': 'Files',
  'inspector.tabGit': 'Changes',
  'inspector.tabBrowser': 'Browser',
  'inspector.tabMemory': 'Memory',
  'inspector.gitEmpty': 'No Git workspace changes',
  'inspector.gitEmptySub': 'Code modifications or commit diffs will appear here',
  'inspector.browserEmpty': 'No active browser viewport',
  'inspector.browserEmptySub': 'Agent web automation and viewport screenshots will project here',
  'inspector.browserWaiting': 'Waiting for viewport stream...',
  'inspector.memoryEmpty': 'No cognitive memories stored',
  'inspector.memoryEmptySub': 'Long-term user preferences and project insights will be listed here',
  'inspector.resizeHandleTitle': 'Drag to resize right pane · Double click to reset',
  'inspector.remoteNotice': 'File located in remote gateway workspace without direct access',
  'inspector.loadingNotice': 'Loading latest content from workspace...',

  'status.connected': 'Connected',
  'status.connecting': 'Connecting...',
  'status.disconnected': 'Disconnected',
};

export type Locale = 'zh-CN' | 'en-US';

export const DICTIONARIES: Record<Locale, Record<I18nKey, string>> = {
  'zh-CN': zhDict,
  'en-US': enDict,
};

let currentLocale: Locale = 'zh-CN';

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: I18nKey, params?: Record<string, string | number>): string {
  const dict = DICTIONARIES[currentLocale] || zhDict;
  let text: string = dict[key] ?? zhDict[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}
