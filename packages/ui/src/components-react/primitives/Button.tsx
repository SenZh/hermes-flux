import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

/*
 * 设计意图(Why)：对标 OpenChamber button.tsx 的扁平微透着色按钮（Flat Tinted）与柔和面板圆角（8px），
 *   消除刺眼的纯色实心块与生硬直角，三档尺寸共用同一语义圆角。
 * 约束与规则(Rules)：圆角只允许出现在 base 一层，尺寸档禁止再覆盖 radius。
 */
const buttonVariants = cva('box-border inline-flex items-center justify-center gap-2 rounded-card border border-transparent text-body font-medium tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50', {
  variants: {
    variant: {
      default: 'btn-tint-primary',
      secondary: 'bg-secondary text-secondary-foreground border-border-subtle hover:bg-card-hover',
      outline: 'border-border bg-transparent text-foreground hover:bg-card-hover',
      ghost: 'text-foreground hover:bg-card-hover',
      destructive: 'btn-tint-destructive',
    },
    /*
     * 【设计意图 (Why)】xs 档服务"贴在密集行内的确认动作"（行内确认条、行内表单），
     *   这类场景的按钮与 11~12px 的说明文字同排，用 sm 的 32px 高度 + 13px 字号会把
     *   一整条说明压成三行大字，用户的评价是"按钮太大、字体太大、太丑"。
     * 【约束与规则 (Rules)】xs 是桌面端下限：h-7 = 28px，恰好等于审查规范的
     *   桌面触控热区下限 28px，禁止再往下开档；移动端形态不得使用 xs。
     */
    size: {
      default: 'h-9 px-4 py-2',
      sm: 'h-8 px-3',
      xs: 'h-7 px-2 text-aux',
      lg: 'h-10 px-6',
      icon: 'size-9',
      'icon-sm': 'size-8',
      'icon-xs': 'size-7',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps): React.ReactElement {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
