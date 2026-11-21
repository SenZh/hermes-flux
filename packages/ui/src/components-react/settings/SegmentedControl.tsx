import * as React from 'react';
import { cn } from '../../lib/utils.js';

/**
 * 设置中心的分段选择控件（唯一实现，两档外观形态）。
 *
 * 【设计意图 (Why)】
 *   视角切换、量表档位、语言选择以及添加弹窗的双页签共用同一语义与 ARIA 规范。
 *   设置页内出现第二份实现必然漂移出不同的高度、圆角与按压态。
 *
 * 【约束与规则 (Rules)】
 *   1. 只用语义 Token 与 4px 网格，不写色值、不用旧刻度；
 *   2. `compact`（默认）：行内 32px（按钮 24px）轻量分段；
 *   3. `tabs`：满宽双栏页签（36px 触控高度 + 阴影 + 强边框），让切换模式清晰一目了然。
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  variant = 'compact',
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  variant?: 'compact' | 'tabs';
}): React.ReactElement {
  if (variant === 'tabs') {
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn(
          options.length === 2 ? 'grid grid-cols-2' : 'flex',
          'w-full gap-1 rounded-panel border border-border bg-input p-1',
        )}
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={active}
              data-segmented-value={option.value}
              onClick={() => onChange(option.value)}
              className={cn(
                'flex h-9 flex-1 items-center justify-center gap-2 rounded-card border text-body transition-colors',
                active
                  ? 'border-border-strong bg-card-active font-semibold text-foreground shadow-card'
                  : 'border-transparent font-medium text-muted-foreground hover:text-foreground',
              )}
            >
              {option.icon ? <span aria-hidden="true" className="shrink-0">{option.icon}</span> : null}
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex h-8 items-center gap-1 rounded-card border border-border bg-input p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            data-segmented-value={option.value}
            onClick={() => onChange(option.value)}
            className={`h-6 rounded-inner px-3 text-caption transition-colors ${
              active ? 'bg-card-active font-medium text-foreground' : 'text-secondary-foreground hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
