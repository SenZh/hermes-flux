import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

/*
 * Textarea — 多行文本输入的唯一合法实现。
 *
 * 设计意图(Why)：
 *   Input 与 textarea 在设置中心必须共享同一组物理属性（圆角、边框、底色、focus ring、
 *   disabled 态）。历史上 textarea 是在业务里逐字复制 Input 的 className，改一次 ring
 *   就要在两个地方各改一遍，最终漂移成两种边框。
 *
 * 约束与规则(Rules)：
 *   1. 几何与 Input 同源，尺寸档只表达最小高度，不改变圆角与描边；
 *   2. resize 由调用方决定（默认 none，需要用户拉伸时显式传 resize-y）；
 *   3. 需要等宽字体时传 className="font-code"，不在本组件内新增变体。
 */

const textareaVariants = cva(
  'flex w-full resize-none rounded-card border border-border bg-input px-3 py-2 text-body leading-relaxed text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        default: 'min-h-24',
        sm: 'min-h-16',
        xs: 'min-h-12 px-2 py-1 text-aux',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

export interface TextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'>,
    VariantProps<typeof textareaVariants> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, size, ...props }, ref) => (
  <textarea ref={ref} className={cn(textareaVariants({ size }), className)} {...props} />
));
Textarea.displayName = 'Textarea';

export { textareaVariants };
