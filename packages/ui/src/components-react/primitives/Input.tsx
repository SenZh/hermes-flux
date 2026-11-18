import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const inputVariants = cva(
  'flex w-full rounded-card border border-border bg-input text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        default: 'h-9 px-3 py-1 text-body',
        sm: 'h-8 px-3 py-1 text-body',
        xs: 'h-7 px-2 py-1 text-aux',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, size, ...props }, ref) => (
  <input ref={ref} type={type} className={cn(inputVariants({ size }), className)} {...props} />
));
Input.displayName = 'Input';

export { inputVariants };
