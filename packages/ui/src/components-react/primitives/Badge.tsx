import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const badgeVariants = cva('inline-flex items-center rounded-full border px-2 py-1 text-caption font-semibold transition-colors', {
  /**
   * 设计意图 (Why)：
   *   徽标是"状态标注"，不是主要操作。default 用实心主色（bg-primary）会让一处行尾标签
   *   比对侧的主按钮还抢眼，直接违反"强调色控制在 5% 以内"；规范给徽标的强调形态是
   *   「主色微透底 + 主色描边 + 前景文字」，这里照此实现。
   * 约束与规则 (Rules)：
   *   实心主色只保留给真正的操作按钮；徽标禁止出现 bg-primary。
   */
  variants: { variant: {
    default: 'border-primary-border bg-primary-subtle text-foreground',
    secondary: 'border-transparent bg-secondary text-secondary-foreground',
    outline: 'border-border text-foreground',
    destructive: 'border-transparent bg-destructive text-foreground',
  } }, defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}
export function Badge({ className, variant, ...props }: BadgeProps): React.ReactElement {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
