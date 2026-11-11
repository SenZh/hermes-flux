import * as React from 'react';

/**
 * 设置中心的分段选择控件（唯一实现）。
 *
 * 【设计意图 (Why)】
 *   视角切换、量表档位、语言选择共用同一种形态。设置页内出现第二份实现，
 *   必然会漂移出不同的高度与圆角，这属于设计系统明令禁止的样式双标。
 *
 * 【约束与规则 (Rules)】
 *   1. 只用语义 Token，不写色值；
 *   2. 高度固定 28px（h-7），字阶固定 caption；
 *   3. 选中态用 `bg-card-active`，这是设置页激活行的唯一真值。
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}): React.ReactElement {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex items-center gap-1 rounded-card border border-border bg-input p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            data-segmented-value={option.value}
            onClick={() => onChange(option.value)}
            className={`h-7 rounded-inner px-2 text-caption transition-colors ${
              active ? 'bg-card-active text-foreground' : 'text-secondary-foreground hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
