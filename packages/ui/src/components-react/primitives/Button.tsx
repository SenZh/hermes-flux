import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

/*
 * 设计意图(Why)：圆角统一走 inner 档（4px）。按钮是"贴在表面上的控件"，
 *   不属于卡片/面板/浮层任何一种表面，因此三档尺寸共用同一个语义圆角。
 * 防范的历史坑(Pitfall)：曾出现 base 用 card(6px)、sm 用 inner(4px)、lg 又回到 card 的自相矛盾，
 *   同一排按钮大小不同却圆角不同，视觉上像两套控件库拼出来的。
 * 约束与规则(Rules)：圆角只允许出现在 base 一层，尺寸档禁止再覆盖 radius；需要更大圆角请用别的基础组件。
 */
const buttonVariants = cva('box-border inline-flex items-center justify-center gap-2 rounded-inner border-0 text-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
      secondary: 'bg-secondary text-secondary-foreground hover:bg-card-hover',
      outline: 'border border-border bg-transparent text-foreground hover:bg-accent',
      ghost: 'text-foreground hover:bg-accent',
      destructive: 'bg-destructive text-foreground hover:opacity-90',
    },
    size: { default: 'h-9 px-4 py-2', sm: 'h-8 px-3', lg: 'h-10 px-6', icon: 'size-9' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps): React.ReactElement {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
