/**
 * 工具行与工具区
 *
 * 设计意图(Why)：
 *   工具是执行轨迹的主体。分类、目标、状态、耗时、输出必须同屏可读，
 *   只读工具聚合为一行 chips，写操作逐条可见。所有行统一由 StreamRow 渲染。
 *
 * 防范的历史坑(Pitfall)：
 *   旧模板用 tool-duration-badge 在 running 时按 data-start-time 本地累加；
 *   React 化后若只读 durationMs，运行中的命令会一直不显示时间，用户无法判断是否卡死。
 *
 * 约束与规则(Rules)：
 *   1. 分类只做展示映射，分类结果由宿主给出的 name 决定，不在组件内解析正文；
 *   2. 状态色只用语义变量（--success / --destructive / --primary）；
 *   3. 保留 #msg-tools-<id> 锚点，工具补丁通道仍然有效；
 *   4. 运行中计时由共享秒脉冲驱动，complete 后以 durationMs 冻结。
 */

import * as React from 'react';
import { t } from '../../i18n/index.js';
import { extractToolTarget } from '../../lib/text.js';
import type { ConversationToolVM } from './types.js';
import { StreamRow, type StreamRowKind } from './StreamRow.js';
import { FileTypeIcon } from './FileTypeIcon.js';
import { useNow } from './useNow.js';

interface ToolPresentation {
  kind: StreamRowKind;
  label: string;
  readOnly: boolean;
}

/**
 * 工具名 → 展示分类。
 * 写操作匹配必须排在通用 file 之前，否则 write_file 会被误判成只读。
 */
export function classifyTool(name: string): ToolPresentation {
  const raw = (name || '').toLowerCase();
  if (raw.includes('shell') || raw.includes('bash') || raw.includes('cmd') || raw.includes('terminal')) {
    return { kind: 'command', label: t('tool.shell'), readOnly: false };
  }
  if (raw.includes('skill')) {
    return { kind: 'skill', label: t('tool.generic'), readOnly: false };
  }
  if (raw.includes('write')) return { kind: 'write', label: t('tool.write'), readOnly: false };
  if (raw.includes('edit') || raw.includes('patch')) {
    return { kind: 'edit', label: t('tool.edit'), readOnly: false };
  }
  if (raw.includes('read') || raw.includes('cat')) {
    return { kind: 'read', label: t('tool.read'), readOnly: true };
  }
  if (raw.includes('grep') || raw.includes('search')) {
    return { kind: 'search', label: t('tool.search'), readOnly: false };
  }
  if (raw.includes('glob') || raw.includes('find')) {
    return { kind: 'search', label: t('tool.find'), readOnly: false };
  }
  if (raw.includes('subagent') || raw.includes('agent')) {
    return { kind: 'agent', label: t('tool.agent'), readOnly: false };
  }
  if (raw.includes('browser') || raw.includes('playwright') || raw.includes('navigate')) {
    return { kind: 'browser', label: 'Browser', readOnly: false };
  }
  return { kind: 'other', label: name || t('tool.generic'), readOnly: false };
}

/**
 * 工具目标：统一走深度提取，兼容信封 args / JSON 字符串 / 纯文本。
 * 【防范的历史坑 (Pitfall)】直接取 args 第一行会把 `{"command":"..."}` 整段 JSON 显示出来。
 */
function shortTarget(args: string): string {
  const target = extractToolTarget(args);
  if (!target) return '';
  const firstLine = target.split('\n')[0].trim();
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
}

function fileName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

export interface ToolCapsuleProps {
  tool: ConversationToolVM;
  /** 共享秒脉冲；running 时用于实时累加耗时 */
  now?: number;
}

export function ToolCapsule({ tool, now }: ToolCapsuleProps): React.ReactElement {
  const presentation = classifyTool(tool.name);
  const target = shortTarget(tool.args);
  const liveMs =
    tool.durationMs ??
    (tool.status === 'running' && tool.startedAt ? Math.max(0, (now ?? Date.now()) - tool.startedAt) : undefined);
  const duration = liveMs !== undefined ? `${(liveMs / 1000).toFixed(1)}s` : '';
  const display = presentation.readOnly && target ? fileName(target) : target;

  // 文件类工具：左侧直接显示文件类型图标，替代通用的工具形状图标
  const showsFileIcon = Boolean(target) && ['read', 'write', 'edit'].includes(presentation.kind);

  return (
    <StreamRow
      kind={presentation.kind}
      label={presentation.label}
      target={display || undefined}
      meta={duration || undefined}
      status={tool.status}
      expandable={Boolean(tool.output)}
      title={target}
      iconOverride={showsFileIcon ? <FileTypeIcon filePath={target} /> : undefined}
    >
      {tool.output ? <pre className="conv-row__output">{tool.output}</pre> : null}
    </StreamRow>
  );
}

export interface ToolSectionProps {
  messageId: string;
  tools: ConversationToolVM[];
}

function ReadGroup({ tools, now }: { tools: ConversationToolVM[]; now?: number }): React.ReactElement {
  return (
    <StreamRow
      kind="read"
      label={t('tool.readGroup', { count: String(tools.length) })}
      target={
        <span className="conv-row__chips">
          {tools.map((tool) => (
            <span key={tool.id} className="conv-row__chip">
              {fileName(shortTarget(tool.args))}
            </span>
          ))}
        </span>
      }
      expandable
    >
      <div className="conv-row__group">
        {tools.map((tool) => (
          <ToolCapsule key={tool.id} tool={tool} now={now} />
        ))}
      </div>
    </StreamRow>
  );
}

/**
 * 工具区块内容（不含 #msg-tools 外壳）。
 *
 * 【设计意图 (Why)】
 *   React 全量渲染与流式补丁通道必须产出同一份结构，否则流式期间一套样式、
 *   收敛后又变成另一套，用户会看到明显的形态跳变。
 *   把内容抽成独立组件后，两条通道都渲染 ToolBlocks。
 */
export function ToolBlocks({ tools }: { tools: ConversationToolVM[] }): React.ReactElement {
  // 只有存在未完成的运行项时才启用秒脉冲，完成态不空转定时器
  const hasRunning = tools.some((tool) => tool.status === 'running' && tool.durationMs === undefined);
  const now = useNow(hasRunning);

  const blocks: React.ReactNode[] = [];
  let index = 0;
  while (index < tools.length) {
    const tool = tools[index];
    if (classifyTool(tool.name).readOnly) {
      let end = index;
      while (end < tools.length && classifyTool(tools[end].name).readOnly) end++;
      const group = tools.slice(index, end);
      blocks.push(
        group.length === 1 ? (
          <ToolCapsule key={group[0].id} tool={group[0]} now={now} />
        ) : (
          <ReadGroup key={`read-${group[0].id}`} tools={group} now={now} />
        )
      );
      index = end;
    } else {
      blocks.push(<ToolCapsule key={tool.id} tool={tool} now={now} />);
      index++;
    }
  }

  // 单工具直通：多包一层折叠会让「一个命令」变成两次点击
  if (tools.length <= 1) {
    return <>{blocks}</>;
  }

  const runningCount = tools.filter((tool) => tool.status === 'running').length;
  const completedCount = tools.filter((tool) => tool.status === 'completed').length;
  const failedCount = tools.filter((tool) => tool.status === 'failed').length;
  // 【设计意图 (Why)】打包卡片收起时用户仍需要知道"现在到底在跑什么命令"，
  // 只给"N 个工具执行中"等于让用户盲等。
  const runningTool = tools.find((tool) => tool.status === 'running');
  const runningTarget = runningTool ? shortTarget(runningTool.args) : '';
  const statusSummary = hasRunning
    ? t('tool.executingSummary', {
        running: String(runningCount),
        total: String(tools.length),
        completed: String(completedCount),
      })
    : failedCount > 0
    ? t('tool.completedWithFailed', { completed: String(completedCount), failed: String(failedCount) })
    : t('tool.completedAll', { completed: String(completedCount) });

  return (
    <details className="conv-package" open={hasRunning || undefined}>
      <summary className="conv-package__summary">
          <span className="conv-package__icon">
            {hasRunning ? (
              <svg
                className="conv-package__spinner"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="9 11 12 14 22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            )}
          </span>
          <svg
            className="conv-package__expand"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span className="conv-package__title">{t('tool.packageTitle', { count: String(tools.length) })}</span>
          {runningTarget ? (
            <span className="conv-package__cmd" title={runningTarget}>
              {runningTarget}
            </span>
          ) : null}
          <span className="conv-package__status">{statusSummary}</span>
        </summary>
        <div className="conv-package__body">{blocks}</div>
      </details>
  );
}

/**
 * 工具区块外壳：#msg-tools-<id> 锚点必须留在这一层。
 *
 * 【防范的历史坑 (Pitfall)】
 *   流式补丁通道直写该容器的 innerHTML，锚点若是 details 会把 summary 一起冲掉。
 * 【约束与规则 (Rules)】
 *   外壳只负责定位，不承载任何内容逻辑；内容一律走 ToolBlocks。
 */
export function ToolSection({ messageId, tools }: ToolSectionProps): React.ReactElement {
  return (
    <div className="conv-tools" id={`msg-tools-${messageId}`}>
      <ToolBlocks tools={tools} />
    </div>
  );
}
