/*
 * Toolbar —— 面板顶部工具条的唯一合法实现。
 *
 * 设计意图(Why)：
 *   36px 高、底部分隔发丝线、左右两翼插槽 + 中间自适应内容，是设计系统里"工具条"这一语义的全部内容。
 *   业务视图只需要决定"左边放什么、右边放什么"，高度与分隔线由组件锁定，
 *   于是同屏三块面板的工具条必然等高、必然对齐，不需要任何人工协调。
 *
 * 防范的历史坑(Pitfall)：
 *   1. 历史上每处工具条各写一遍 h-10 / h-12 / border-b + 自定义 padding，同一列面板的工具条高低不齐；
 *   2. sticky 只能作用于自身滚动容器。缺 bg-panel 时吸顶会让下方内容从工具条底下透出来，
 *      看起来像工具条"半透明"，因此 sticky 必须同时挂底色（本组件已内置，禁止业务自己再加半套底色）。
 *
 * 约束与规则(Rules)：
 *   1. 高度锁定 h-9（36px），禁止 min-h-* 或 py-* 撑高；
 *   2. 只允许一条分隔线的语义（border-border-subtle），禁止改成粗分割或双线；
 *   3. 左右翼内容禁止自带外边距，间距统一由 gap-2 提供，避免"两侧不齐"的隐性漂移。
 */
import * as React from 'react';
import { cn } from '../../lib/utils.js';

export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 左翼插槽：标题、返回按钮或视图切换。 */
  leading?: React.ReactNode;
  /** 右翼插槽：主操作按钮组。 */
  trailing?: React.ReactNode;
  /** 是否吸顶；仅在该工具条的直接父级是滚动容器时有意义。 */
  sticky?: boolean;
}

export const Toolbar = React.forwardRef<HTMLDivElement, ToolbarProps>(function Toolbar(
  { leading, trailing, sticky = false, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      data-atom="toolbar"
      className={cn(
        'box-border flex h-9 items-center gap-2 border-b border-border-subtle px-2',
        sticky && 'sticky top-0 bg-panel',
        className,
      )}
      {...rest}
    >
      {leading ? <div className="flex shrink-0 items-center gap-2">{leading}</div> : null}
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      {trailing ? <div className="flex shrink-0 items-center gap-2">{trailing}</div> : null}
    </div>
  );
});

Toolbar.displayName = 'Toolbar';
