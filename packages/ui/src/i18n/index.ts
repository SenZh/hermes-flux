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
  'titlebar.latency': '网关延迟',
  'titlebar.online': '在线',
  'titlebar.offline': '离线',
  'titlebar.toggleTheme': '切换深色/浅色皮肤',
  'titlebar.newChatTooltip': '新建会话 (+)',

  // Left Rail
  'rail.newChat': '新建会话',
  'rail.searchPlaceholder': '搜索历史会话...',
  'rail.conversations': '会话',
  'rail.groups': '群聊',
  'rail.groupsEmpty': '暂无协同群聊',
  'rail.groupsMembers': '{count} 位专家',
  'rail.archived': '归档会话',
  'rail.emptyTitle': '暂无历史会话',
  'rail.emptySub': '点击上方按钮开启全新会话任务',
  'rail.errorTitle': '暂时无法显示历史会话',
  'rail.errorSub': '请检查网关连接后重试',
  'rail.pinnedBots': 'Bots',
  'rail.defaultBotRole': '专职智能助手',
  'rail.defaultBotSnippet': '专职智能助手已就绪',
  'rail.enterBotChat': '进入 {name} 的专属对话',
  'rail.showMore': '展示更多 (还有 {count} 条)',
  'rail.projects': '工程项目矩阵 (Projects)',
  'rail.projectsEmpty': '暂无工程项目',
  'rail.projectsEmptySub': '连接网关后可在工作区创建或关联本地工程项目',
  'rail.projectNoSessions': '该项目暂无关联会话',
  'rail.tabChats': '会话',
  'rail.tabProjects': '项目',

  // New Task & Group Modal
  'modal.newTaskTitle': '发起新任务 / 协同群聊',
  'modal.taskTypeSolo': '专职 Agent 任务',
  'modal.taskTypeGroup': '多智能体研讨群聊',
  'modal.selectAgent': '选择执行智能体 (Agent)',
  'modal.selectMembers': '选择参会智能体 (至少 2 位)',
  'modal.selectProject': '关联项目工作空间 (可选)',
  'modal.noProject': '全局独立工作空间 (不关联项目)',
  'modal.taskTitleLabel': '任务名称 / 研讨论题',
  'modal.taskTitlePlaceholder': '请输入任务目标或研讨论题...',
  'modal.startTask': '立即启动任务',
  'modal.cancel': '取消',

  // Middle Pod & Timeline
  'chat.welcomeTitle': 'Hermes Flux 工作台已就绪',
  'chat.defaultTaskTitle': '新任务',
  'chat.defaultGroupTitle': '新研讨群聊',
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
  'dock.enterBotChatFailed': '进入 Bot [{name}] 主工位失败: {error}',
  'dock.createGroupFailed': '创建群聊失败: {error}',
  'group.defaultRoomName': '多智能体研讨室',
  'group.welcomeInit': '### 👥 {name}\n本研讨室已建立，参会成员：**{members}**。\n各位专家成员将在本研讨室围绕任务展开协同推演。',
  'group.welcomeReady': '### 👥 {name}\n本研讨室已就绪，参会成员：**{members}**。\n可以在下方输入舱下达多智能体研讨目标。',

  // Time Units
  'time.minutesAgo': '{count}分',
  'time.hoursAgo': '{count}小时',
  'time.daysAgo': '{count}天',
  'time.yesterday': '昨天',
  'time.dayBefore': '前天',
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
  'inspector.clickToPreview': '点击在右侧检查舱预览与下载: {file}',
  'inspector.clickToOpenLink': '点击在右侧检查舱预览或打开链接: {url}',
  'inspector.downloadSuccess': '已成功保存文件',
  'inspector.imageLoadError': '图片未能加载',
  'inspector.imageLoadErrorSub': '该图片位于远端网关工作区，可通过下方按钮尝试下载或重新拉取',
  'inspector.sliceNotice': '会话工具切片读取',
  'inspector.gapNotice': '未在会话中读取',

  // Status Bar
  'status.connected': '已连接',
  'status.connecting': '连接中...',
  'status.disconnected': '未连接',
  'status.configureGateway': '点击配置网关服务器',

  // Common Feedback
  'common.copy': '复制',
  'common.copied': '已复制',

  // Subagent Delegation & Live Terminal
  'subagent.cardTitle': '子代理委派任务',
  'subagent.statusRunning': '运行中',
  'subagent.statusThinking': '推理中',
  'subagent.statusCompleted': '已完成',
  'subagent.statusInterrupted': '已终止',
  'subagent.statusFailed': '失败',
  'subagent.viewStream': '⚡ 穿透查看执行流',
  'subagent.interrupt': '⏹ 中止',
  'subagent.steerPlaceholder': '输入实时干预指令 (Enter 发送)...',
  'subagent.steerSend': '干预',
  'subagent.emptyLogs': '正在等待子代理执行流推流...',
  'subagent.tabTitle': '⚡ 子代理穿透终端',
  'subagent.closeSheet': '关闭',
  'subagent.logCount': '{count} 行',

  // Bot Management & Forever Chat
  'bot.foreverChat': '终身专属工位',
  'bot.enterWorkspace': '进入主工位',
  'bot.toolsCount': '{count} 个专属工具',
  'bot.memoryLocked': '长效记忆物理隔离中',

  // Multi-Agent Group & Promotion
  'group.roomTitle': '多 Agent 协同研讨室',
  'group.members': '{count} 位专家研讨',
  'group.seedMemoTitle': '会议种子背景备忘录',
  'group.promoteBtn': '👥 升级为研讨群聊',
  'group.dialogTitle': '发起多智能体研讨会议',
  'group.dialogTopic': '研讨议题',
  'group.dialogSelectMembers': '选择参会专家 (至少 2 位)',
  'group.dialogConfirm': '立即发起会议',
  'group.dialogCancel': '取消',
  'group.emptyFeed': '研讨会议室已就绪，等待发言...',
  'group.placeholder': '向群聊会议室发言... (Enter 发送)',
  'group.send': '发言',
  'group.legacyReadOnly': '该群聊是官方桌面端的历史本地记录，网关未托管此房间，无法在此发送新消息。',
  'group.sendFailed': '发送失败：{error}',

  // Project & Workspace Tree
  'project.treeTitle': '工作区文件目录树',
  'project.emptyTree': '暂无目录树数据',
  'project.primaryFolder': '主工作区根目录',

  // BTW Isolated Capsule
  'btw.capsuleTitle': '外援咨询胶囊',
  'btw.isolatedNotice': '只读外援 · 零上下文污染',
  'btw.copyAnswer': '引用至输入框',
} as const;

export type I18nKey = keyof typeof zhDict;

export const enDict: Record<I18nKey, string> = {
  'titlebar.defaultTitle': 'Hermes Flux — Select or create a session',
  'titlebar.notConnected': 'Gateway Disconnected',
  'titlebar.toggleLeftRail': 'Toggle Left Rail (Ctrl+B)',
  'titlebar.toggleInspector': 'Toggle Inspector Pod (Ctrl+\\)',
  'titlebar.settings': 'System Settings',
  'titlebar.latency': 'Gateway Latency',
  'titlebar.online': 'Online',
  'titlebar.offline': 'Offline',
  'titlebar.toggleTheme': 'Toggle Dark/Light Theme',
  'titlebar.newChatTooltip': 'New Session (+)',

  'rail.newChat': 'New Session',
  'rail.searchPlaceholder': 'Search sessions...',
  'rail.conversations': 'Sessions',
  'rail.groups': 'Groups',
  'rail.groupsEmpty': 'No Group Rooms',
  'rail.groupsMembers': '{count} Experts',
  'rail.archived': 'Archived Sessions',
  'rail.emptyTitle': 'No Conversation History',
  'rail.emptySub': 'Click the button above to begin a new task',
  'rail.errorTitle': 'Failed to Load Sessions',
  'rail.errorSub': 'Please check gateway connection and retry',
  'rail.pinnedBots': 'Bots',
  'rail.defaultBotRole': 'Dedicated Specialist',
  'rail.defaultBotSnippet': 'Dedicated assistant ready',
  'rail.enterBotChat': 'Open chat with {name}',
  'rail.showMore': 'Show more ({count} remaining)',
  'rail.projects': 'Projects',
  'rail.projectsEmpty': 'No Projects Available',
  'rail.projectsEmptySub': 'Connect to gateway to create or link local projects',
  'rail.projectNoSessions': 'No sessions associated with this project',
  'rail.tabChats': 'Chats',
  'rail.tabProjects': 'Projects',

  // New Task & Group Modal
  'modal.newTaskTitle': 'Start New Task / Group Room',
  'modal.taskTypeSolo': 'Dedicated Agent Task',
  'modal.taskTypeGroup': 'Multi-Agent Group Room',
  'modal.selectAgent': 'Select Agent',
  'modal.selectMembers': 'Select Members (at least 2)',
  'modal.selectProject': 'Associate Project Workspace (Optional)',
  'modal.noProject': 'Global Standalone Workspace',
  'modal.taskTitleLabel': 'Task Name / Discussion Topic',
  'modal.taskTitlePlaceholder': 'Enter task goal or discussion topic...',
  'modal.startTask': 'Start Task Now',
  'modal.cancel': 'Cancel',

  'chat.welcomeTitle': 'Hermes Flux Workspace Ready',
  'chat.defaultTaskTitle': 'New Task',
  'chat.defaultGroupTitle': 'New Group Discussion',
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
  'dock.enterBotChatFailed': 'Failed to enter Bot [{name}] workspace: {error}',
  'dock.createGroupFailed': 'Failed to create group: {error}',
  'group.defaultRoomName': 'Multi-Agent Room',
  'group.welcomeInit': '### 👥 {name}\nRoom initialized with members: **{members}**.\nSpecialists will collaborate and deliberate on goals here.',
  'group.welcomeReady': '### 👥 {name}\nRoom ready with members: **{members}**.\nDispatch collaborative goals in the input dock below.',

  // Time Units
  'time.minutesAgo': '{count}m',
  'time.hoursAgo': '{count}h',
  'time.daysAgo': '{count}d',
  'time.yesterday': 'Yesterday',
  'time.dayBefore': '2d ago',
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
  'inspector.clickToPreview': 'Click to preview and download in inspector: {file}',
  'inspector.clickToOpenLink': 'Click to preview or open link in inspector: {url}',
  'inspector.downloadSuccess': 'File saved successfully',
  'inspector.imageLoadError': 'Image failed to load',
  'inspector.imageLoadErrorSub': 'This asset is located in remote gateway workspace. Click download to fetch.',
  'inspector.sliceNotice': 'Session Tool Slice Read',
  'inspector.gapNotice': 'not captured in session',

  'status.connected': 'Connected',
  'status.connecting': 'Connecting...',
  'status.disconnected': 'Disconnected',
  'status.configureGateway': 'Configure Gateway Server',

  'common.copy': 'Copy',
  'common.copied': 'Copied',

  // Subagent Delegation & Live Terminal
  'subagent.cardTitle': 'Subagent Task',
  'subagent.statusRunning': 'Running',
  'subagent.statusThinking': 'Thinking',
  'subagent.statusCompleted': 'Completed',
  'subagent.statusInterrupted': 'Interrupted',
  'subagent.statusFailed': 'Failed',
  'subagent.viewStream': '⚡ Inspect Live Stream',
  'subagent.interrupt': '⏹ Interrupt',
  'subagent.steerPlaceholder': 'Type steering instruction (Enter to send)...',
  'subagent.steerSend': 'Steer',
  'subagent.emptyLogs': 'Waiting for subagent execution stream...',
  'subagent.tabTitle': '⚡ Subagent Live Terminal',
  'subagent.closeSheet': 'Close',
  'subagent.logCount': '{count} lines',

  // Bot Management & Forever Chat
  'bot.foreverChat': 'Forever Chat',
  'bot.enterWorkspace': 'Enter Workplace',
  'bot.toolsCount': '{count} tools',
  'bot.memoryLocked': 'Long-term Memory Isolated',

  // Multi-Agent Group & Promotion
  'group.roomTitle': 'Multi-Agent Room',
  'group.members': '{count} specialists',
  'group.seedMemoTitle': 'Seed Briefing Memo',
  'group.promoteBtn': '👥 Promote to Group',
  'group.dialogTitle': 'Initiate Swarm Meeting',
  'group.dialogTopic': 'Meeting Topic',
  'group.dialogSelectMembers': 'Select Specialists (min 2)',
  'group.dialogConfirm': 'Start Meeting',
  'group.dialogCancel': 'Cancel',
  'group.emptyFeed': 'Group room ready, waiting for discussion...',
  'group.placeholder': 'Speak in meeting room... (Enter to send)',
  'group.send': 'Send',
  'group.legacyReadOnly': 'This room is a legacy local record from the official desktop app; the gateway does not host it, so new messages cannot be sent here.',
  'group.sendFailed': 'Send failed: {error}',

  // Project & Workspace Tree
  'project.treeTitle': 'Workspace File Tree',
  'project.emptyTree': 'No file tree data',
  'project.primaryFolder': 'Primary Root Folder',

  // BTW Isolated Capsule
  'btw.capsuleTitle': 'Specialist Advice',
  'btw.isolatedNotice': 'Read-only · Zero Context Pollution',
  'btw.copyAnswer': 'Quote to Input',
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
