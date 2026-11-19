import * as React from 'react';
import { cn } from '../../lib/utils.js';

/**
 * 设置项行骨架（唯一实现）。
 *
 * 【设计意图 (Why)】
 *   设置页有两种真实形态：横向行（左标签 + 右控件）与纵向字段（标签压在控件上方）。
 *   形态不同，但内距、字阶、标签与提示的关系必须同源，否则每个面板都会漂出一套
 *   自己认为"看起来差不多"的间距，最终同一页里出现三种 8px / 6px / 10px 的跳动。
 *   本文件是这两种形态的唯一落点，其他面板禁止手写 `<label className="flex ...">`。
 *
 * 【防范的历史坑 (Pitfall)】
 *   历史实现里 `SettingRow` 寄生在 SettingsModal 内部且未导出，于是新面板只能复制一份
 *   `<label flex flex-col gap-1>` —— 两份骨架的 border、py、gap 全部不一致，属设计系统
 *   第 4 条点名的同构复制。
 *
 * 【约束与规则 (Rules)】
 *   1. 只用语义 Token 与 4px 网格整数档，不写色值、不写小数间距；
 *   2. 纵向字段的标签用 `text-aux`（12px），比 `text-caption`（11px）高半档，
 *      避免标签与按钮同档导致信息阶梯塌平；
 *   3. 控件区永远 `shrink-0`（横向）或 `w-full`（纵向），不参与文字换行竞争。
 */

/** 横向行：左标签右控件。用于开关、选择器、行内动作。 */
export function SettingRow({
  label,
  hint,
  htmlFor,
  onLabelActivate,
  anchorId,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  /**
   * 控件不是原生表单元素（如 Radix Switch 渲染为 button）时的整行激活回调。
   * 【为什么需要】`label[for]` 只对 labelable 元素生效，对 `button[role=switch]` 无效，
   *   不给回调时点标签没有任何反应，热区只剩行尾那个 32px 的开关。
   */
  onLabelActivate?: () => void;
  /** 检索跳转锚点；设置中心按此定位并做一次性高亮。 */
  anchorId?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      data-settings-anchor={anchorId}
      className="flex items-start justify-between gap-6 border-b border-border-subtle py-3 last:border-b-0"
    >
      <div className="min-w-0">
        {onLabelActivate ? (
          <button type="button" onClick={onLabelActivate} className="block text-left text-body text-foreground">
            {label}
          </button>
        ) : (
          <label htmlFor={htmlFor} className="block text-body text-foreground">
            {label}
          </label>
        )}
        {hint ? <p className="mt-1 text-caption text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** 纵向字段：标签在上，控件撑满。用于表单输入。 */
export function SettingField({
  label,
  htmlFor,
  anchorId,
  children,
}: {
  label: string;
  htmlFor?: string;
  /** 检索跳转锚点；设置中心按此定位并做一次性高亮。 */
  anchorId?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2" data-settings-anchor={anchorId}>
      <label htmlFor={htmlFor} className="text-aux text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

/** 设置大区容器：自带底部微距发丝分割线与 24px 呼吸留白。 */
export function SettingSection({
  className,
  anchorId,
  children,
}: {
  className?: string;
  /** 检索跳转锚点；设置中心按此定位并做一次性高亮。 */
  anchorId?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      data-settings-anchor={anchorId}
      className={cn('flex flex-col gap-3 border-b border-border-subtle pb-6 last:border-b-0', className)}
    >
      {children}
    </section>
  );
}

/** 内嵌分组容器：用 L2 面板底色承载成组设置行，拉开与浮层背景的层次。 */
export function SettingInset({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={cn('flex flex-col rounded-panel border border-border-subtle bg-panel px-4 py-1', className)}>
      {children}
    </div>
  );
}

/** 双栏字段网格：用于并排表单输入。 */
export function SettingTwoColumn({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return <div className={cn('grid grid-cols-2 gap-4', className)}>{children}</div>;
}
