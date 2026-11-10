/*
 * ListRow —— 所有"一行实体"的唯一合法行实现（会话行、群聊行、提供商行、成员行…）。
 *
 * 设计意图(Why)：
 *   列表行是整个工作台复用度最高的原子：48px 基准行高 + 8px 内缩 + 4px 内圆角 + 13px 正文，
 *   这套几何一旦被每个业务视图各写一遍，就会出现"会话行 44px、群聊行 52px"的横向漂移。
 *   因此行高、内圆角、字号、四态交互全部在这里锁定，业务只负责往 leading / children / trailing 三个插槽里放内容。
 *
 * 防范的历史坑(Pitfall)：
 *   1. 交互四态（hover / active / focus-visible / disabled）历史上经常缺一两态，
 *      最典型的是键盘 Tab 到行上没有任何可见反馈（focus-visible 缺失），
 *      以及 disabled 后仍响应点击。四态在这里一次性写全，禁止业务侧再加半套；
 *   2. 行高不能写 min-h-*：行内容一变高就把相邻行顶开，滚动位置与虚拟化锚点一起失真。
 *
 * 约束与规则(Rules)：
 *   1. 高必须是 h-12（48px 基准行高），禁止 min-h-* / py-* 拼高度；
 *   2. 颜色只允许 bg-card-hover / bg-card-active / bg-primary-subtle 这几个语义 Token；
 *   3. 行本身不承载省略逻辑之外的内容（截断用 truncate），需要多行请另建组件，禁止在本组件加 wrap 开关。
 */
import * as React from 'react';
import { cn } from '../../lib/utils.js';

export interface ListRowProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  /** 行首插槽：头像、图标或状态点。 */
  leading?: React.ReactNode;
  /** 行尾插槽：操作按钮、徽标或数值。 */
  trailing?: React.ReactNode;
  /** 行主内容（单行，超出截断）。 */
  children?: React.ReactNode;
  /** 是否为当前活跃行（例如正在打开的会话），静态底色加深。 */
  active?: boolean;
  /** 是否为选中行（多选或当前焦点项），底色 + 强调边框同时出现。 */
  selected?: boolean;
  /** 渲染标签，默认 button（保证键盘可达）；纯展示场景可传 div。 */
  as?: 'button' | 'div';
  /** 禁用态，透传到 button 的 disabled 属性。 */
  disabled?: boolean;
}

export const ListRow = React.forwardRef<HTMLElement, ListRowProps>(function ListRow(
  { leading, trailing, children, active = false, selected = false, as = 'button', disabled = false, className, ...rest },
  ref,
) {
  const classes = cn(
    // 透明 1px 边框是几何占位：选中态要画 1px 发丝线，若只在选中行加边框，
    // box-border 下内容会被向内挤 1px，三行圆点与文字左缘对不齐（截图可复现）。
    'box-border flex h-12 w-full items-center gap-2 rounded-inner border border-transparent px-2 text-left text-body text-secondary-foreground transition-colors',
    'hover:bg-card-hover',
    'active:bg-card-active',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    'disabled:pointer-events-none disabled:opacity-50',
    active && 'bg-card-hover text-foreground',
    selected && 'border border-border-strong bg-card-active text-foreground',
    // div 形态没有 :disabled 伪类，禁用样式必须显式补一遍，否则 div 行禁用后毫无变化
    disabled && 'pointer-events-none opacity-50',
    className,
  );

  const content = (
    <>
      {leading ? <span className="flex shrink-0 items-center justify-center">{leading}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing ? <span className="flex shrink-0 items-center gap-2">{trailing}</span> : null}
    </>
  );

  if (as === 'div') {
    return (
      <div ref={ref as React.Ref<HTMLDivElement>} data-atom="list-row" className={classes} aria-disabled={disabled || undefined} {...rest}>
        {content}
      </div>
    );
  }

  return (
    <button ref={ref as React.Ref<HTMLButtonElement>} type="button" data-atom="list-row" className={classes} disabled={disabled} {...rest}>
      {content}
    </button>
  );
});

ListRow.displayName = 'ListRow';
