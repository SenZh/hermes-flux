/**
 * 功能域：代理、子代理与群组（agent / subagent / group / project）
 *
 * 约束与规则 (Rules)：
 *   1. 禁止给下面两个对象加任何类型注解。一旦写成 `Record<string, string>`，
 *      该域全部 key 会从 I18nKey 联合中消失（消费者 t() 立即报 TS2345），
 *      key-guard.ts 还会逐域断言 key 必须保持字面量联合（TS2344）。
 *   2. 一行一词条，禁止同行压缩：同行压缩会污染 diff 并掩盖漏译。
 */
export const zhAgents = {
  // Agent Profile Editor Modal
  'agent.editTitle': '编辑 BOT 配置',
  'agent.displayName': '显示名称',
  'agent.profileId': '唯一标识 (ID)',
  'agent.description': '角色描述',
  'agent.descriptionPlaceholder': '介绍该 BOT 的专长与职责...',
  'agent.modelBinding': '绑定模型 (可选)',
  'agent.defaultModel': '使用全局默认模型',
  'agent.skillsAndTools': '挂载技能与工具集',
  'agent.systemPrompt': '系统人设与设定词 (System Prompt)',
  'agent.systemPromptPlaceholder': '设定该 BOT 的专业背景、语气与行为规范...',
  'agent.changeAvatar': '更换头像',
  'agent.saveChanges': '保存更改',
  'agent.saveSuccess': 'BOT 配置已保存',
  'agent.officialCoreAgent': '官方核心默认 BOT',
  'agent.customDedicatedAgent': '自定义专职 BOT',
  'agent.namePlaceholder': '请输入 BOT 对外显示的名字...',
  'agent.skillShell': '终端执行 (Shell)',
  'agent.skillShellDesc': '执行系统命令与脚本',
  'agent.skillFileOps': '文件读写 (File Ops)',
  'agent.skillFileOpsDesc': '读取、写入与打补丁',
  'agent.skillWebSearch': '网络检索 (Web Search)',
  'agent.skillWebSearchDesc': '联网搜索与信息检索',
  'agent.skillCodeReview': '代码审查 (Code Review)',
  'agent.skillCodeReviewDesc': '架构与代码规范核验',
  'group.defaultRoomName': '多智能体研讨室',
  'group.welcomeInit': '### 👥 {name}\n本研讨室已建立，参会成员：**{members}**。\n各位专家成员将在本研讨室围绕任务展开协同推演。',
  'group.welcomeReady': '### 👥 {name}\n本研讨室已就绪，参会成员：**{members}**。\n可以在下方输入舱下达多智能体研讨目标。',

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
};

export const enAgents = {
  // Agent Profile Editor Modal
  'agent.editTitle': 'Edit BOT Configuration',
  'agent.displayName': 'Display Name',
  'agent.profileId': 'Profile ID',
  'agent.description': 'Description',
  'agent.descriptionPlaceholder': 'Describe this BOT strengths and duties...',
  'agent.modelBinding': 'Model Binding (Optional)',
  'agent.defaultModel': 'Use Global Default Model',
  'agent.skillsAndTools': 'Skills & Tools',
  'agent.systemPrompt': 'System Instructions & Persona',
  'agent.systemPromptPlaceholder': 'Define this BOT background, tone and behavioral rules...',
  'agent.changeAvatar': 'Change Avatar',
  'agent.saveChanges': 'Save Changes',
  'agent.saveSuccess': 'BOT configuration saved',
  'agent.officialCoreAgent': 'Official Core BOT',
  'agent.customDedicatedAgent': 'Custom Dedicated BOT',
  'agent.namePlaceholder': 'Enter the BOT display name...',
  'agent.skillShell': 'Terminal Execution (Shell)',
  'agent.skillShellDesc': 'Execute system commands and scripts',
  'agent.skillFileOps': 'File Operations (File Ops)',
  'agent.skillFileOpsDesc': 'Read, write and patch files',
  'agent.skillWebSearch': 'Web Search',
  'agent.skillWebSearchDesc': 'Online search and retrieval',
  'agent.skillCodeReview': 'Code Review',
  'agent.skillCodeReviewDesc': 'Architecture & code quality checks',
  'group.defaultRoomName': 'Multi-Agent Room',
  'group.welcomeInit': '### 👥 {name}\nRoom initialized with members: **{members}**.\nSpecialists will collaborate and deliberate on goals here.',
  'group.welcomeReady': '### 👥 {name}\nRoom ready with members: **{members}**.\nDispatch collaborative goals in the input dock below.',

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
};
