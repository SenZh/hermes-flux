/**
 * 工具胶囊与工具区
 *
 * 设计意图(Why)：
 *   工具是执行轨迹的主体。分类、目标、状态、耗时、diff 统计与输出必须同屏可读，
 *   而不是全部折叠成一行名字。只读工具聚合为一行 chips，写操作逐条可见。
 *
 * 约束与规则(Rules)：
 *   1. 分类只做展示映射，分类结果由宿主给出的 name 决定，不在组件内解析正文；
 *   2. 状态色只用语义变量（--success / --destructive / --primary）；
 *   3. 保留 #msg-tools-<id> 锚点，工具补丁通道仍然有效。
 */

import * as React from 'react';
import { t } from '../../i18n/index.js';
import type { ConversationToolVM } from './types.js';

type ToolKind = 'shell' | 'write' | 'edit' | 'read' | 'search' | 'glob' | 'agent' | 'other';

interface ToolPresentation {
  kind: ToolKind;
  label: string;
  icon: React.ReactElement;
  readOnly: boolean;
}

function icon(path: React.ReactNode): React.ReactElement {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {path}
    </svg>
  );
}

const ICONS: Record<ToolKind, React.ReactElement> = {
  shell: icon(
    <>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </>
  ),
  write: icon(
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="16" y2="18" />
    </>
  ),
  edit: icon(
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </>
  ),
  read: icon(
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
    </>
  ),
  search: icon(
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  glob: icon(
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  agent: icon(
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="1.5" />
      <circle cx="15" cy="9" r="1.5" />
      <path d="M8 15h8" />
    </>
  ),
  other: icon(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />),
};

/**
 * 工具名 → 展示分类。
 * 写操作匹配必须排在通用 file 之前，否则 write_file 会被误判成只读。
 */
export function classifyTool(name: string): ToolPresentation {
  const raw = (name || '').toLowerCase();
  if (raw.includes('shell') || raw.includes('bash') || raw.includes('cmd') || raw.includes('terminal')) {
    return { kind: 'shell', label: t('tool.shell'), icon: ICONS.shell, readOnly: false };
  }
  if (raw.includes('write')) return { kind: 'write', label: t('tool.write'), icon: ICONS.write, readOnly: false };
  if (raw.includes('edit') || raw.includes('patch')) {
    return { kind: 'edit', label: t('tool.edit'), icon: ICONS.edit, readOnly: false };
  }
  if (raw.includes('read') || raw.includes('cat')) {
    return { kind: 'read', label: t('tool.read'), icon: ICONS.read, readOnly: true };
  }
  if (raw.includes('grep') || raw.includes('search')) {
    return { kind: 'search', label: t('tool.search'), icon: ICONS.search, readOnly: false };
  }
  if (raw.includes('glob') || raw.includes('find')) {
    return { kind: 'glob', label: t('tool.find'), icon: ICONS.glob, readOnly: false };
  }
  if (raw.includes('subagent') || raw.includes('agent')) {
    return { kind: 'agent', label: t('tool.agent'), icon: ICONS.agent, readOnly: false };
  }
  return { kind: 'other', label: name || t('tool.generic'), icon: ICONS.other, readOnly: false };
}

function shortTarget(args: string): string {
  if (!args) return '';
  const firstLine = args.split('\n')[0].trim();
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
}

function fileName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

export interface ToolCapsuleProps {
  tool: ConversationToolVM;
}

export function ToolCapsule({ tool }: ToolCapsuleProps): React.ReactElement {
  const presentation = classifyTool(tool.name);
  const target = shortTarget(tool.args);
  const duration = tool.durationMs ? `${(tool.durationMs / 1000).toFixed(1)}s` : '';
  const state = tool.status;

  const summary = (
    <summary className="conv-tool__summary">
      <span className="conv-tool__icon">{presentation.icon}</span>
      <span className="conv-tool__name">{presentation.label}</span>
      {presentation.readOnly && target ? (
        <span className="conv-tool__file">
          <span className="conv-tool__file-name">{fileName(target)}</span>
        </span>
      ) : target ? (
        <span className="conv-tool__target" title={target}>
          {target}
        </span>
      ) : null}
      {duration ? <span className="conv-tool__time">{duration}</span> : null}
    </summary>
  );

  if (!tool.output) {
    return (
      <div className="conv-tool" data-tool-status={state} data-tool-id={tool.id}>
        {summary}
      </div>
    );
  }

  return (
    <details className="conv-tool" data-tool-status={state} data-tool-id={tool.id}>
      {summary}
      <pre className="conv-tool__output">{tool.output}</pre>
    </details>
  );
}

export interface ToolSectionProps {
  messageId: string;
  tools: ConversationToolVM[];
}

function ReadGroup({ tools }: { tools: ConversationToolVM[] }): React.ReactElement {
  return (
    <details className="conv-tool conv-tool--group" data-tool-group="read">
      <summary className="conv-tool__summary">
        <span className="conv-tool__icon">{ICONS.read}</span>
        <span className="conv-tool__name">{t('tool.readGroup', { count: String(tools.length) })}</span>
        <span className="conv-tool__chips">
          {tools.map((tool) => (
            <span key={tool.id} className="conv-tool__chip">
              {fileName(shortTarget(tool.args))}
            </span>
          ))}
        </span>
      </summary>
      <div className="conv-tool__group-body">
        {tools.map((tool) => (
          <ToolCapsule key={tool.id} tool={tool} />
        ))}
      </div>
    </details>
  );
}

export function ToolSection({ messageId, tools }: ToolSectionProps): React.ReactElement {
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
          <ToolCapsule key={group[0].id} tool={group[0]} />
        ) : (
          <ReadGroup key={`read-${group[0].id}`} tools={group} />
        )
      );
      index = end;
    } else {
      blocks.push(<ToolCapsule key={tool.id} tool={tool} />);
      index++;
    }
  }

  return (
    <div className="conv-tools" id={`msg-tools-${messageId}`}>
      {blocks}
    </div>
  );
}
