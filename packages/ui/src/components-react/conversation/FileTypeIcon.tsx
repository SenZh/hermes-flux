/**
 * 文件类型图标（React 路径）。
 * 【设计意图 (Why)】读取 / 写入 / 编辑文件时，左侧图标直接显示文件类型（CSS、JS、TS、MD…），
 *   与 OpenChamber 的文件树一致；统一走 lib/fileTypeIcons.ts 的三层解析。
 * 【约束与规则 (Rules)】只输出 sprite 引用，不在此处绘制图标；CSS 控制尺寸与对齐。
 */

import * as React from 'react';
import { resolveFileTypeIcon } from '../../lib/fileTypeIcons.js';

export interface FileTypeIconProps {
  filePath: string;
  className?: string;
}

export function FileTypeIcon({ filePath, className = 'md-file__icon' }: FileTypeIconProps): React.ReactElement {
  const id = resolveFileTypeIcon(filePath);
  return (
    <span className={className} data-icon={id}>
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <use href={`#${id}`} />
      </svg>
    </span>
  );
}
