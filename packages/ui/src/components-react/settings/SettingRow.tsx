import * as React from 'react';

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
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-border-subtle py-3 last:border-b-0">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-body text-foreground">
          {label}
        </label>
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
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-aux text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
