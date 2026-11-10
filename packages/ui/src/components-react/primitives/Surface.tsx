/*
 * Surface —— 卡片/主面板的唯一合法容器。
 *
 * 设计意图(Why)：
 *   设计系统里的"底色 + 边框 + 圆角 + 受光线 + 阴影"是一组不可拆的物理属性，
 *   对应的是"这是一个什么级别的表面"（面板 / 卡片 / 浮层），而不是五个可以随手挑的 class。
 *   把这一组收进一个组件后，业务代码只能声明 level，无法再拼出"面板底色 + 卡片圆角 + 窗口阴影"
 *   这种物理上不存在的表面。
 *
 * 防范的历史坑(Pitfall)：
 *   1. 历史上每个视图都自己拼 `bg-* + border + rounded-* + shadow-*`，同一层级的两个面板
 *      可以一个 6px 一个 12px，换肤校验也拦不住（它们全是合法 Token）；
 *   2. 旧式的无语义圆角档与投影档（sm/md/lg/xl 刻度）已在 tailwind-entry.css 里物理清空，
 *      这里只允许语义档位，写旧刻度直接产不出 CSS。
 *
 * 约束与规则(Rules)：
 *   1. 禁止在本组件内出现任意值 class（`-[...]`）与裸色相，所有颜色必须走换肤 Token；
 *   2. 间距只允许 4px 倍数（p-2/p-3/p-4），禁用 p-1.5 / p-2.5 这类小数档；
 *   3. 需要新的一档表面（例如 dock）必须先在设计系统里登记语义，禁止在此临时加 prop 旁路。
 */
import * as React from 'react';
import { cn } from '../../lib/utils.js';

/** 表面层级：panel=主面板（最贴近底图）、card=内容卡片、popover=浮层。 */
export type SurfaceLevel = 'panel' | 'card' | 'popover';
/** 内边距档位：none=0 / tight=8px / normal=12px / loose=16px，全部为 4px 网格整数倍。 */
export type SurfacePadding = 'none' | 'tight' | 'normal' | 'loose';

const LEVEL_CLASS: Record<SurfaceLevel, string> = {
  panel: 'bg-panel',
  card: 'bg-card',
  popover: 'bg-popover',
};

const PADDING_CLASS: Record<SurfacePadding, string> = {
  none: '',
  tight: 'p-2',
  normal: 'p-3',
  loose: 'p-4',
};

export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 表面层级，默认 card。 */
  level?: SurfaceLevel;
  /** 内边距档位，默认 normal（12px）。 */
  padding?: SurfacePadding;
  /** 是否带 1px 发丝边框，默认 true。 */
  bordered?: boolean;
  /** 是否带顶部 1px 受光线，默认 true（深色皮肤下用于区分层级）。 */
  specular?: boolean;
  /** 是否抬起一层阴影，默认 false（只有真正悬浮于底图之上的卡片才需要）。 */
  elevated?: boolean;
}

export const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  {
    level = 'card',
    padding = 'normal',
    bordered = true,
    specular = true,
    elevated = false,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <div
      ref={ref}
      data-atom="surface"
      className={cn(
        // 圆角是表面的固有属性，与有没有边框无关：bordered=false 只去掉发丝线，
        // 不能连圆角一起掉，否则出现"方块底色"这种物理上不存在的表面。
        // box-border 必须显式声明：本基座刻意不带 preflight（无全局 border-box），
        // 组件一旦带边框，content-box 会让 p-3 的表面凭空高出 2px。
        'relative box-border rounded-card',
        LEVEL_CLASS[level],
        PADDING_CLASS[padding],
        bordered && 'border border-border-subtle',
        specular && 'specular-top',
        elevated && 'shadow-card',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

Surface.displayName = 'Surface';
