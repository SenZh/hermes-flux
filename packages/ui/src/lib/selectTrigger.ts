import { cva } from 'class-variance-authority';

/**
 * 下拉/选择器触发按钮共享样式定义（Select 与 ModelPickerField 共用同一真值）。
 *
 * 【设计意图 (Why)】
 *   `Select` 与 `ModelPickerField` 的触发按钮必须保持完全一致的几何、填充、边框与键盘焦点环，
 *   避免在一个弹窗内从 Input / Select Tab 到 ModelPickerField 时出现焦点框样式漂移。
 */
export const selectTriggerVariants = cva(
  'flex w-full items-center gap-2 rounded-card border border-border bg-input text-left text-foreground transition-colors hover:bg-card-hover focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        default: 'h-9 px-3 text-body',
        sm: 'h-8 px-3 text-body',
        xs: 'h-7 px-2 text-aux',
      },
    },
    defaultVariants: { size: 'default' },
  },
);
