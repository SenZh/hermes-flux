/**
 * 工具输出渲染器
 *
 * 设计意图 (Why)：
 *   协议信封由 lib/toolOutput 归一化成可读视图，本组件只负责把这五种视图
 *   （终端文本 / 差异 / 匹配 / 文件 / 字段）渲染成一致的排版，
 *   保证「命令返回 JSON」这种形态永远不出现在用户面前。
 *
 * 约束与规则 (Rules)：
 *   1. 不解析业务语义，一切形状判断都在 lib/toolOutput；
 *   2. 空视图不渲染任何容器，避免出现空折叠区；
 *   3. 颜色只用语义 Token，禁止硬编码色值。
 */

import * as React from 'react';
import { t } from '../../i18n/index.js';
import type { ToolOutputView } from '../../lib/toolOutput.js';

/** 单次最多渲染的匹配行数：网关通常已截断，这里只防御异常大结果。 */
const MAX_MATCH_ROWS = 120;

function diffLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'conv-diff__line conv-diff__line--file';
  if (line.startsWith('@@')) return 'conv-diff__line conv-diff__line--hunk';
  if (line.startsWith('+')) return 'conv-diff__line conv-diff__line--add';
  if (line.startsWith('-')) return 'conv-diff__line conv-diff__line--del';
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'conv-diff__line conv-diff__line--file';
  return 'conv-diff__line';
}

function DiffBody({ diff }: { diff: string }): React.ReactElement {
  return (
    <pre className="conv-tool-output__diff-body">
      {diff.split('\n').map((line, index) => (
        <span key={index} className={diffLineClass(line)}>
          {line.length ? line : '\u00a0'}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

export function ToolOutputBody({ view }: { view: ToolOutputView }): React.ReactElement | null {
  switch (view.kind) {
    case 'empty':
      return null;

    case 'text':
      return <pre className="conv-tool-output__text">{view.text}</pre>;

    case 'diff':
      return (
        <div className="conv-tool-output__diff">
          {view.files.length ? (
            <div className="conv-tool-output__files">
              {view.files.map((file) => (
                <span key={file} className="conv-tool-output__file" title={file}>{file}</span>
              ))}
            </div>
          ) : null}
          <DiffBody diff={view.diff} />
        </div>
      );

    case 'matches': {
      const shown = view.matches.slice(0, MAX_MATCH_ROWS);
      const hidden = view.total > shown.length ? view.total - shown.length : view.matches.length - shown.length;
      if (shown.length === 0) {
        return <div className="conv-tool-output__empty">{t('tool.noMatches')}</div>;
      }
      return (
        <div className="conv-tool-output__matches">
          {shown.map((match, index) => (
            <div className="conv-match" key={`${match.path}:${match.line ?? index}:${index}`}>
              {match.path ? <span className="conv-match__path" title={match.path}>{match.path}</span> : null}
              {match.line !== null ? <span className="conv-match__line">{match.line}</span> : null}
              <span className="conv-match__text">{match.text}</span>
            </div>
          ))}
          {hidden > 0 ? (
            <div className="conv-tool-output__empty">{t('tool.moreMatches', { count: String(hidden) })}</div>
          ) : null}
        </div>
      );
    }

    case 'files':
      return (
        <div className="conv-tool-output__files">
          {view.files.map((file) => (
            <span key={file} className="conv-tool-output__file" title={file}>{file}</span>
          ))}
        </div>
      );

    case 'fields':
      return (
        <dl className="conv-tool-output__fields">
          {view.fields.map((field) => (
            <div className="conv-field" key={field.key}>
              <dt className="conv-field__key">{field.key}</dt>
              <dd className="conv-field__value">{field.value}</dd>
            </div>
          ))}
        </dl>
      );

    default:
      return null;
  }
}

/** 工具输出容器：错误与提示固定在正文外侧，正文形态由归一化视图决定。 */
export function ToolOutput({ view }: { view: ToolOutputView }): React.ReactElement | null {
  if (view.kind === 'empty' && !view.error && !view.note) return null;
  return (
    <div className="conv-tool-output">
      {view.error ? <div className="conv-tool-output__error">{view.error}</div> : null}
      <ToolOutputBody view={view} />
      {view.note ? <div className="conv-tool-output__note">{view.note}</div> : null}
    </div>
  );
}
