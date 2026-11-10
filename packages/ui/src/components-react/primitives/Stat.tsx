/*
 * Stat —— 单个度量读数的唯一合法实现（提供商数、模型数、延迟…）。
 *
 * 设计意图(Why)：
 *   度量块是"小标题 + 大读数 + 变化量"的三段式竖排，字阶固定为 caption / title / aux。
 *   把三档字阶收进组件后，同屏多个读数必然对齐同一条基线，不会出现
 *   "这个数字 16px、那个数字 20px"这种靠肉眼判断的排版漂移。
 *
 * 防范的历史坑(Pitfall)：
 *   1. 变化量的正负曾经被各视图用裸色相表达（绿/红直接写死），换肤后完全失效；
 *      这里只允许 success / warning / error 三个语义色调，颜色真值由皮肤决定；
 *   2. 读数容器历史上用"大内边距 + 面板档圆角 + 投影"拼出来，与相邻卡片层级不同却看不出差别，
 *      现在统一走 card 档背景 + 发丝边框，禁止在本组件外再套一层自拼边框。
 *
 * 约束与规则(Rules)：
 *   1. 容器几何锁定：p-3 + rounded-card + bg-card + border-border-subtle，禁止外部改成浮层外观；
 *   2. 间距只允许 4px 倍数（gap-1 / p-3），禁用 p-1.5、p-2.5 这类小数档；
 *   3. value 只能是单个读数，禁止塞多行说明（说明属于旁边的 Surface 文本区）。
 */
import * as React from 'react';
import { cn } from '../../lib/utils.js';

/** 变化量色调：neutral=中性（无涨跌语义）、success=正向、warning=需关注、error=异常。 */
export type StatTone = 'neutral' | 'success' | 'warning' | 'error';

const TONE_CLASS: Record<StatTone, string> = {
  neutral: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-destructive',
};

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 度量名称（小标题）。 */
  label: React.ReactNode;
  /** 度量读数（大数字或短文本）。 */
  value: React.ReactNode;
  /** 可选变化量 / 补充说明。 */
  delta?: React.ReactNode;
  /** 变化量色调，默认 neutral。 */
  tone?: StatTone;
}

export const Stat = React.forwardRef<HTMLDivElement, StatProps>(function Stat(
  { label, value, delta, tone = 'neutral', className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      data-atom="stat"
      className={cn('box-border flex flex-col gap-1 rounded-card border border-border-subtle bg-card p-3', className)}
      {...rest}
    >
      <span className="text-caption text-muted-foreground">{label}</span>
      <span className="text-title text-foreground">{value}</span>
      {delta ? <span className={cn('text-aux', TONE_CLASS[tone])}>{delta}</span> : null}
    </div>
  );
});

Stat.displayName = 'Stat';
