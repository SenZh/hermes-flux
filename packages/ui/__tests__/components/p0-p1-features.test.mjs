import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LeftRail } from '../../dist/components-react/LeftRail.js';
import { buildLeftRailModel } from '../../dist/components-react/leftRailModel.js';
import { renderNewTaskModal } from '../../dist/components/TaskModal/NewTaskModal.js';
import { renderInputDock } from '../../dist/components/InputDock/InputDock.js';
import { renderTitlebar } from '../../dist/components/Titlebar/Titlebar.js';
import { renderContextMenu } from '../../dist/components/ContextMenu/ContextMenu.js';

/** 左轨 React 岛的测试渲染入口，语义与旧 renderLeftRail(props) 一一对应。 */
function renderLeftRail(props = {}) {
  const noop = () => {};
  return renderToStaticMarkup(React.createElement(LeftRail, {
    model: buildLeftRailModel({
      activeSessionId: props.activeSessionId || '',
      activeFocus: props.activeFocus,
      sessions: props.sessions || [],
      profileName: props.profileName || 'default',
      profiles: props.profiles || [],
      groups: props.groups || [],
      projects: props.projects || [],
      activeRailTab: props.activeRailTab || 'chats',
      searchQuery: props.searchQuery || '',
      isSessionsGroupExpanded: props.isSessionsGroupExpanded,
      isGroupsGroupExpanded: props.isGroupsGroupExpanded,
      error: props.error,
    }),
    collapsed: Boolean(props.collapsed),
    searchQuery: props.searchQuery || '',
    editingGroupRoomId: props.editingGroupRoomId,
    onSelectSession: noop,
    onSelectBot: noop,
    onSelectGroup: noop,
    onOpenSessionMenu: noop,
    onOpenBotMenu: noop,
    onOpenGroupMenu: noop,
    onSearchChange: noop,
    onNewChat: noop,
    onSetTab: noop,
    onToggleSessions: noop,
    onToggleGroups: noop,
    onStartGroupRename: noop,
    onConfirmGroupRename: noop,
    onCancelGroupRename: noop,
    onResizeStart: noop,
  }));
}
import { renderAgentProfileEditorModal } from '../../dist/components/Bot/AgentProfileEditorModal.js';
import { renderMessages } from '../helpers/renderMessages.mjs';

test('P0 & P1 Features Rigorous Suite - Multi-Quadrant & Mutation Verified', async (t) => {
  await t.test('1. 发言者身份 Badge: 仅非 user 且有 sender 时渲染，变异断言角色隔离', () => {
    // 1.1 Assistant with sender -> 必须渲染 badge、名称与头像
    const assistantHtml = renderMessages([
        {
          id: 'msg-group-1',
          role: 'assistant',
          content: '各位专家，这是第一轮推演方案。',
          sender: 'arch-wang',
          senderAvatar: 'data:image/png;base64,mock',
          timestamp: '14:20',
        },
      ]);
    assert.ok(assistantHtml.includes('message-sender-badge'), 'Assistant 消息必须包含发言者信息徽章');
    assert.ok(assistantHtml.includes('arch-wang'), '必须展示发言智能体名称');
    assert.ok(assistantHtml.includes('data:image/png;base64,mock'), '必须包含发言智能体头像');

    // 1.1b 群聊场景：多智能体连续发言（同为 assistant 但 sender 不同），第二位智能体必须完整呈现发言者身份与独立头像
    const groupChatHtml = renderMessages([
        {
          id: 'msg-g-1',
          role: 'assistant',
          content: '架构方案推演中...',
          sender: 'arch-wang',
          senderAvatar: 'data:image/png;base64,arch-avatar',
          timestamp: '14:20',
        },
        {
          id: 'msg-g-2',
          role: 'assistant',
          content: '前端与美学已跟进对齐！',
          sender: 'aura',
          senderAvatar: 'data:image/png;base64,aura-avatar',
          timestamp: '14:21',
        },
      ], { mode: 'group' });
    assert.ok(groupChatHtml.includes('arch-wang'), '第一位发言智能体必须呈现');
    assert.ok(groupChatHtml.includes('data:image/png;base64,arch-avatar'), '第一位智能体头像必须呈现');
    assert.ok(groupChatHtml.includes('aura'), '第二位不同发言智能体必须呈现');
    assert.ok(groupChatHtml.includes('data:image/png;base64,aura-avatar'), '第二位智能体头像必须呈现（防连续 assistant 吞头像）');

    // 1.2 User message -> 严禁包含 message-sender-badge
    const userHtml = renderMessages([
        {
          id: 'msg-user-1',
          role: 'user',
          content: '你好',
          sender: 'user',
          timestamp: '14:21',
        },
      ]);
    assert.ok(!userHtml.includes('message-sender-badge'), 'User 消息严禁渲染发言者身份徽章');
  });

  await t.test('2. 会话与群聊三态指示器: 排他性与准确性检验 (running / unread / read)', () => {
    const railHtml = renderLeftRail({
      collapsed: false,
      activeSessionId: 'sess-1',
      profileName: 'default',
      gatewayOnline: true,
      gatewayLatencyMs: 20,
      sessions: [
        {
          id: 'sess-1',
          title: '已读会话',
          activityState: 'read',
        },
        {
          id: 'sess-2',
          title: '正在回答会话',
          activityState: 'running',
        },
        {
          id: 'sess-3',
          title: '未读会话',
          activityState: 'unread',
        },
      ],
      groups: [
        {
          roomId: 'room-1',
          name: '测试研讨群',
          members: ['arch-wang', 'default'],
          activityState: 'running',
        },
        {
          roomId: 'room-2',
          name: '已读研讨群',
          members: ['arch-wang', 'default'],
          activityState: 'read',
        },
      ],
    });

    // 正向断言
    assert.ok(railHtml.includes('activity-pulse-indicator'), '必须渲染正在回答的动态脉冲指示器');
    assert.ok(railHtml.includes('activity-unread-badge'), '必须渲染未读小圆点徽标');

    // 排他性断言：纯 read 会话的 row 内绝对不能包含指示器类名
    const sess1Chunk = railHtml.slice(railHtml.indexOf('data-id="sess-1"'), railHtml.indexOf('data-id="sess-2"'));
    assert.ok(!sess1Chunk.includes('activity-pulse-indicator'), '已读会话严禁包含运行中指示器');
    assert.ok(!sess1Chunk.includes('activity-unread-badge'), '已读会话严禁包含未读小圆点徽标');
  });

  await t.test('3. 工具执行卡片: 单工具直通不打包、运行态自动展开、失败汇总与纯完成折叠', () => {
    // 3.1 极限边界：单个工具时必须直通，严禁渲染外层打包卡片
    const singleToolHtml = renderMessages([
        {
          id: 'msg-single-tool',
          role: 'assistant',
          content: '正在单步执行',
          toolCalls: [
            {
              id: 'tc-solo',
              name: 'read_file',
              status: 'completed',
              args: '{"path":"main.ts"}',
            },
          ],
          timestamp: '14:21',
        },
      ]);
    assert.ok(!singleToolHtml.includes('conv-package'), '单工具调用严禁渲染外层打包卡片');

    // 3.2 运行态多工具：必须渲染打包卡片且默认 open 展开
    const runningToolsHtml = renderMessages([
        {
          id: 'msg-tools-running',
          role: 'assistant',
          content: '正在多步分析',
          toolCalls: [
            { id: 'tc-1', name: 'read_file', status: 'completed', args: '{"path":"a.ts"}' },
            { id: 'tc-2', name: 'execute_shell', status: 'running', args: '{"command":"npm test"}' },
          ],
          timestamp: '14:22',
        },
      ]);
    assert.ok(runningToolsHtml.includes('conv-package'), '多工具必须渲染打包卡片');
    assert.ok(runningToolsHtml.includes('open'), '有正在执行的工具时卡片必须自动 open 展开');
    assert.ok(runningToolsHtml.includes('Running'), '包含运行中工具时必须显示正在执行状态');
    assert.ok(runningToolsHtml.includes('npm test'), '卡片头部必须实时渲染当前正在执行的命令');
    assert.ok(!runningToolsHtml.includes('[object Object]'), '严禁泄露 [object Object] 裸文本');

    // 3.3 负向异常多工具：包含失败工具时必须明确显示失败计数
    const failedToolsHtml = renderMessages([
        {
          id: 'msg-tools-failed',
          role: 'assistant',
          content: '执行完毕但有报错',
          toolCalls: [
            { id: 'tc-3', name: 'read_file', status: 'completed', args: '{"path":"a.ts"}' },
            { id: 'tc-4', name: 'execute_shell', status: 'failed', args: '{"command":"build"}' },
          ],
          timestamp: '14:23',
        },
      ]);
    assert.ok(failedToolsHtml.includes('1 failed'), '包含失败工具时必须展示失败汇总文案');
    assert.ok(!failedToolsHtml.includes('<details class="conv-package" open'), '无运行态工具时严禁默认展开');
  });

  await t.test('4. 输入框自适应与智能折叠/展开', () => {
    const dockHtml = renderInputDock({
      selectedModel: 'gpt-4o',
      reasoningLevel: 'default',
      approvalMode: 'auto',
      isStreaming: false,
    });

    assert.ok(dockHtml.includes('dock-input-collapse-toggle'), '必须包含折叠收起切换按键');
    // 【规则】自适应高度约束在共享样式表里（`.composer-dock__textarea`），不在模板字符串中。
    // 旧断言在 dockHtml 里搜 `max-height: 240px`，实际命中的是思考下拉——思考已下沉到模型行，
    // 这条断言才暴露出它一直在测错对象。
    const dockCss = fs.readFileSync(new URL('../../src/styles/conversation.css', import.meta.url), 'utf8');
    const textareaRule = /\.composer-dock__textarea\s*\{([\s\S]*?)\}/.exec(dockCss);
    assert.ok(textareaRule, '必须定义 .composer-dock__textarea');
    assert.match(textareaRule[1], /max-height:\s*240px/, '输入框必须具备自适应伸展最大高度约束 (240px)');
  });

  await t.test('5. 新建任务弹窗: 单选与多选 Agent 真实头像渲染、Workspace 下拉选择与标题自动生成', () => {
    const modalHtml = renderNewTaskModal({
      isOpen: true,
      selectedProfile: 'default',
      profiles: [
        {
          name: 'arch-wang',
          displayName: '架构王',
          avatar: 'data:image/png;base64,arch-avatar-bytes',
        },
        {
          name: 'bot-bob',
          displayName: '鲍勃',
        },
      ],
      projects: [
        {
          id: 'proj-1',
          name: '电商重构工程',
          path: '/workspace/shop',
        },
      ],
    });

    // 5.1 智能体头像变异断言：若删除头像代码，用例必须变红！
    assert.ok(modalHtml.includes('data:image/png;base64,arch-avatar-bytes'), '必须真实渲染指定 Agent 的图片头像');
    assert.ok(modalHtml.includes('modal-agent-option'), '必须渲染智能体选择列表');

    // 5.2 群聊多选模式下的头像渲染
    assert.ok(modalHtml.includes('modal-group-member-checkbox'), '必须包含群聊多选勾选框');

    // 5.3 Workspace 下拉选择
    assert.ok(modalHtml.includes('modal-project-select'), '必须包含项目/工作区选择下拉框');
    assert.ok(modalHtml.includes('电商重构工程'), '必须渲染候选工作区名称');

    // 5.4 标题留空智能自动命名提示
    assert.ok(modalHtml.includes('留空将根据首轮对话自动生成'), '必须包含标题自动生成友好提示');
  });

  await t.test('6. 顶部标题栏支持渲染当前会话所属 Workspace 徽章', () => {
    // 6.1 会话关联项目时，Titlebar 必须渲染 Workspace Badge
    const titlebarWithProject = renderTitlebar({
      platform: 'windows',
      title: '重构结算服务',
      projectName: '电商微服务工程',
      projectPath: 'D:/workspace/shop',
      isMaximized: false,
      gatewayConnected: true,
    });
    assert.ok(titlebarWithProject.includes('session-workspace-badge'), '必须包含 Workspace 徽章容器');
    assert.ok(titlebarWithProject.includes('电商微服务工程'), '必须展示项目名称');

    // 6.2 会话未关联项目时，严禁渲染 session-workspace-badge
    const titlebarWithoutProject = renderTitlebar({
      platform: 'windows',
      title: '普通日常对话',
      isMaximized: false,
      gatewayConnected: true,
    });
    assert.ok(!titlebarWithoutProject.includes('session-workspace-badge'), '未关联项目时严禁渲染 Workspace 徽章');
  });

  await t.test('7. 项目抽屉中联动挂载归属会话树', () => {
    const railHtml = renderLeftRail({
      collapsed: false,
      activeSessionId: 'sess-shop-1',
      profileName: 'default',
      gatewayOnline: true,
      gatewayLatencyMs: 15,
      activeRailTab: 'projects',
      sessions: [],
      projects: [
        {
          id: 'proj-shop',
          name: '商城系统',
          path: 'D:/shop',
          sessions: [
            {
              id: 'sess-shop-1',
              title: '修复支付订单超时',
              time: '15:30',
              model: 'gpt-4o',
            },
          ],
        },
        {
          id: 'proj-empty',
          name: '空项目',
          sessions: [],
        },
      ],
    });

    assert.ok(railHtml.includes('rail-projects-deck'), '必须包含项目看板卡片层');
    assert.ok(railHtml.includes('商城系统'), '必须渲染项目名称');
    assert.ok(railHtml.includes('修复支付订单超时'), '项目展开抽屉中必须挂载归属该项目的会话');
    assert.ok(railHtml.includes('该项目暂无关联会话'), '无会话项目必须提示空态');
  });

  await t.test('8. 右键上下文菜单分流测试 (Bot / Group / Session 三态全覆盖)', () => {
    // 8.1 Bot 右键菜单必须包含编辑智能体且彻底剔除清空历史
    const botMenu = renderContextMenu({
      x: 100,
      y: 200,
      targetType: 'bot',
      targetId: 'arch-wang',
      targetName: '架构王',
    });
    assert.ok(botMenu.includes('data-action="bot-chat"'), 'Bot 菜单必须包含进入专属工位');
    assert.ok(botMenu.includes('data-action="bot-edit"'), 'Bot 菜单必须包含编辑档案');
    assert.ok(botMenu.includes('data-action="copy-id"'), 'Bot 菜单必须包含复制 ID');
    assert.ok(!botMenu.includes('data-action="clear-history"'), 'Bot 菜单严禁包含清空历史');
    assert.ok(!botMenu.includes('data-action="disband-group"'), 'Bot 菜单严禁包含解散群聊');

    // 8.2 Group 右键菜单
    const groupMenu = renderContextMenu({
      x: 120,
      y: 240,
      targetType: 'group',
      targetId: 'room-alpha',
      targetName: '核心研讨群',
    });
    assert.ok(groupMenu.includes('data-action="group-rename"'), '群聊菜单必须包含重命名');
    assert.ok(groupMenu.includes('data-action="disband-group"'), '群聊菜单必须包含解散群聊');
    assert.ok(!groupMenu.includes('data-action="archive"'), '群聊菜单严禁包含会话归档');

    // 8.3 Session 右键菜单
    const sessionMenu = renderContextMenu({
      x: 150,
      y: 300,
      targetType: 'session',
      targetId: 'sess-999',
      targetName: '订单超时排查',
    });
    assert.ok(sessionMenu.includes('data-action="rename"'), '会话菜单必须包含重命名');
    assert.ok(sessionMenu.includes('data-action="pin"'), '会话菜单必须包含置顶');
    assert.ok(sessionMenu.includes('data-action="export"'), '会话菜单必须包含导出 Markdown');
    assert.ok(sessionMenu.includes('data-action="archive"'), '会话菜单必须包含归档');
    assert.ok(sessionMenu.includes('data-action="delete"'), '会话菜单必须包含删除');
    assert.ok(!sessionMenu.includes('data-action="bot-chat"'), '会话菜单严禁包含进入工位');
  });

  await t.test('9. AgentProfileEditorModal 通用智能体档案编辑面板组件渲染与字段完备性', () => {
    // 9.1 关闭状态下返回空
    const closedHtml = renderAgentProfileEditorModal({ isOpen: false });
    assert.equal(closedHtml, '', '关闭时严禁渲染 DOM');

    // 9.2 打开状态下渲染全功能表单字段
    const modalHtml = renderAgentProfileEditorModal({
      isOpen: true,
      profile: {
        name: 'default',
        displayName: '赫尔墨斯',
        description: '核心通用全能架构助手',
        model: 'deepseek-chat',
        systemPrompt: '你是 Hermes 首席架构专家。',
        isDefault: true,
      },
      availableModels: ['deepseek-chat', 'claude-3-5-sonnet'],
    });

    assert.ok(modalHtml.includes('agent-profile-editor-modal'), '必须包含模态框主体');
    assert.ok(modalHtml.includes('赫尔墨斯'), '必须包含当前智能体显示名称');
    assert.ok(modalHtml.includes('default'), '必须包含只读 ID 标识');
    assert.ok(modalHtml.includes('agent-editor-desc'), '必须包含描述文本域');
    assert.ok(modalHtml.includes('agent-editor-model-select'), '必须包含模型选择下拉框');
    assert.ok(modalHtml.includes('claude-3-5-sonnet'), '必须渲染可选模型清单');
    assert.ok(modalHtml.includes('agent-skill-checkbox'), '必须包含技能开关');
    assert.ok(modalHtml.includes('agent-editor-prompt'), '必须包含人设提示词配置文本域');
    assert.ok(modalHtml.includes('btn-save-agent-editor'), '必须包含保存更改按钮');
    assert.ok(modalHtml.includes('btn-cancel-agent-editor'), '必须包含取消按钮');
  });

  await t.test('10. 左轨双轨架构：微轨头像常驻与抽屉第一行大卡片三态与最新对话副标题联动', () => {
    const railHtml = renderLeftRail({
      collapsed: false,
      activeSessionId: 'sess-1',
      profileName: 'default',
      gatewayOnline: true,
      gatewayLatencyMs: 20,
      sessions: [],
      profiles: [
        {
          name: 'default',
          displayName: '赫尔墨斯',
          lastMessage: '已为您重构完架构模块',
          lastTime: '10分钟前',
          activityState: 'running',
          isDefault: true,
        },
        {
          name: 'arch-wang',
          displayName: '架构王',
          lastMessage: '请核实门禁不变量',
          lastTime: '1小时前',
          activityState: 'unread',
        },
      ],
    });

    assert.ok(railHtml.includes('flux-station-rail'), '必须包含左侧常驻微轨');
    assert.ok(!railHtml.includes('rail-bots-accordion-trigger'), '抽屉内严格禁止再出现智能体(N)折叠行');
    assert.ok(railHtml.includes('rail-primary-agent-card'), '抽屉第一行必须渲染当前选中的核心 Agent 大卡片');
    assert.ok(railHtml.includes('赫尔墨斯'), '必须展示当前智能体显示名称');
    assert.ok(railHtml.includes('已为您重构完架构模块'), '必须联动展示智能体名下最新一条真实对话记录');
    assert.ok(railHtml.includes('10分钟前'), '必须展示最新消息相对时间戳');
    assert.ok(railHtml.includes('activity-pulse-indicator'), '运行中智能体必须包含运行态指示器');
    assert.ok(railHtml.includes('activity-unread-badge'), '未读智能体必须包含未读指示器');
  });

  await t.test('11. 群聊原地行内重命名 (inline rename) 渲染断言', () => {
    // 11.1 处于编辑状态下的房间
    const editingRailHtml = renderLeftRail({
      collapsed: false,
      activeSessionId: '',
      profileName: 'default',
      gatewayOnline: true,
      gatewayLatencyMs: 10,
      editingGroupRoomId: 'room-101',
      groups: [
        {
          roomId: 'room-101',
          name: '旧架构研讨组',
          members: ['default', 'arch-wang'],
        },
      ],
      sessions: [],
    });

    assert.ok(editingRailHtml.includes('rail-group-inline-rename-wrap'), '编辑态必须包含行内重命名容器');
    assert.ok(editingRailHtml.includes('rail-group-rename-input'), '必须包含重命名文本输入框');
    // 确认/取消按钮的语义已收编进 Button primitive，断言改为可观察的提交与取消语义
    assert.ok(editingRailHtml.includes('type="submit"'), '必须包含确认提交按钮');
    assert.ok(editingRailHtml.includes('取消'), '必须包含取消按钮文案');

    // 11.2 非编辑状态下的普通房间
    const normalRailHtml = renderLeftRail({
      collapsed: false,
      activeSessionId: '',
      profileName: 'default',
      gatewayOnline: true,
      gatewayLatencyMs: 10,
      editingGroupRoomId: undefined,
      groups: [
        {
          roomId: 'room-101',
          name: '旧架构研讨组',
          members: ['default', 'arch-wang'],
        },
      ],
      sessions: [],
    });

    assert.ok(!normalRailHtml.includes('rail-group-inline-rename-wrap'), '非编辑态严禁包含重命名输入框');
    assert.ok(normalRailHtml.includes('旧架构研讨组'), '必须展示群聊名称文本');
  });
});
