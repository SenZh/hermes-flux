/**
 * 统一执行轨迹行
 *
 * 设计意图(Why)：
 *   思考、命令执行、技能调用、检索、读取在结构上是同一种行：图标 + 标签 + 目标 + 耗时，
 *   可展开时整行可点。此前 thought 与 tool 各写一套类名与结构，间距/字号/图标位反复漂移。
 *   本组件是唯一行实现，差异只通过 kind 与 props 表达。
 *
 * 约束与规则(Rules)：
 *   1. 不解析业务内容，icon/label/target 由调用方给出；
 *   2. 可展开与不可展开共用同一 summary 结构，保证行高与图标位一致；
 *   3. hover 只切换图标为展开箭头，不改背景色。
 */

import * as React from 'react';

export type StreamRowKind =
  | 'thought'
  | 'command'
  | 'skill'
  | 'read'
  | 'search'
  | 'write'
  | 'edit'
  | 'agent'
  | 'browser'
  | 'other';

export interface StreamRowProps {
  kind: StreamRowKind;
  label: string;
  /** 行内目标：命令、路径、摘要或 chips */
  target?: React.ReactNode;
  /** 行尾元数据：耗时、状态等 */
  meta?: React.ReactNode;
  status?: 'running' | 'completed' | 'failed';
  /** 是否可展开；不可展开时渲染为静态行，行高与图标位保持一致 */
  expandable?: boolean;
  title?: string;
  /** 覆盖左侧图标：文件类工具直接显示文件类型图标（CSS/JS/TS…） */
  iconOverride?: React.ReactNode;
  children?: React.ReactNode;
}

function icon(path: React.ReactNode): React.ReactElement {
  return (
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
      {path}
    </svg>
  );
}

export const STREAM_ROW_ICONS: Record<StreamRowKind, React.ReactElement> = {
  thought: icon(
    <>
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
    </>
  ),
  command: icon(
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <path d="m7 11 2-2-2-2" />
      <path d="M11 13h4" />
    </>
  ),
  skill: icon(
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
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
  agent: icon(
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="1.5" />
      <circle cx="15" cy="9" r="1.5" />
      <path d="M8 15h8" />
    </>
  ),
  browser: icon(
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ),
  other: icon(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />),
};

function ExpandChevron(): React.ReactElement {
  return (
    <svg
      className="conv-row__expand"
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
  );
}

export function StreamRow({
  kind,
  label,
  target,
  meta,
  status,
  expandable,
  title,
  iconOverride,
  children,
}: StreamRowProps): React.ReactElement {
  const summary = (
    <>
      <span className="conv-row__icon">{iconOverride ?? STREAM_ROW_ICONS[kind]}</span>
      {expandable ? <ExpandChevron /> : null}
      <span className="conv-row__label">{label}</span>
      {target ? (
        <span className="conv-row__target" title={title}>
          {target}
        </span>
      ) : null}
      {meta ? <span className="conv-row__meta">{meta}</span> : null}
    </>
  );

  if (expandable) {
    return (
      <details className="conv-row" data-kind={kind} data-status={status} data-expandable="true">
        <summary className="conv-row__summary">{summary}</summary>
        {children}
      </details>
    );
  }

  // 不可展开的行不渲染展开箭头，hover 也不切换图标
  return (
    <div className="conv-row" data-kind={kind} data-status={status} data-expandable="false">
      <div className="conv-row__summary">{summary}</div>
    </div>
  );
}
