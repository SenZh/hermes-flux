/**
 * React Markdown 容器
 *
 * 设计意图(Why)：
 *   正文由现有 renderMarkdown 产出 HTML 字符串，这里只负责注入与排版约束；
 *   不在此处解析 Markdown，避免出现第二套渲染器。
 *
 * 约束与规则(Rules)：
 *   1. 只用 dangerouslySetInnerHTML 注入已渲染 HTML，不拼字符串；
 *   2. 每个块级元素的行高与字号由 CSS 统一收敛，禁止组件内写内联字号；
 *   3. 内容变化才重新渲染，避免每次父组件更新都重算 HTML。
 */

import * as React from 'react';
import { renderMarkdown } from '../../components/MiddlePod/MiddlePod.js';
import { mountFileTypeSprite } from '../../lib/fileTypeIcons.js';

export interface MarkdownBlockProps {
  content: string;
  /** 流式直写锚点 ID，缺省时不生成 */
  anchorId?: string;
  className?: string;
}

export function MarkdownBlock({ content, anchorId, className }: MarkdownBlockProps): React.ReactElement | null {
  const html = React.useMemo(() => renderMarkdown(content), [content]);

  // 文件类型图标依赖 document 中的 sprite；挂载一次即可，重复调用无副作用。
  React.useEffect(() => {
    mountFileTypeSprite();
  }, []);

  // 纯工具消息没有正文时不要渲染空容器，否则会在 flex 布局里多占一个块间距
  if (!content.trim()) return null;
  return (
    <div
      id={anchorId}
      className={`conv-markdown${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
