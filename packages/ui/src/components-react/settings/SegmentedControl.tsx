import * as React from 'react';

/**
 * 设置中心的分段选择控件（唯一实现，带 GPU 平滑磁吸滑块）。
 *
 * 【设计意图 (Why)】
 *   视角切换、量表档位、语言选择与能力分类共享同一种分段轨道。把平滑滑移的 Glider
 *   收敛到唯一组件后，全局所有分段控制同步获得无过冲丝滑手感，且零样式双标。
 *
 * 【约束与规则 (Rules)】
 *   1. 只用语义 Token，不写色值；
 *   2. 高度固定 28px/32px 整数网格（h-8 轨道 + h-6 滑块），字阶固定 caption；
 *   3. 选中态底色真值是 `bg-card-active`；SSR 首帧无 DOM 时按钮自身回落 `bg-card-active`。
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}): React.ReactElement {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const btnRefs = React.useRef<Map<string, HTMLButtonElement>>(new Map());
  const [glider, setGlider] = React.useState<{ left: number; width: number } | null>(null);

  const measure = React.useCallback((): void => {
    const activeBtn = btnRefs.current.get(value);
    if (!activeBtn || activeBtn.offsetWidth <= 0) {
      setGlider(null);
      return;
    }
    const next = { left: activeBtn.offsetLeft, width: activeBtn.offsetWidth };
    setGlider((prev) => (prev && prev.left === next.left && prev.width === next.width ? prev : next));
  }, [value]);

  React.useLayoutEffect(() => {
    measure();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    for (const el of btnRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [measure, options]);

  return (
    <div
      ref={trackRef}
      role="group"
      aria-label={ariaLabel}
      className={`relative inline-flex h-8 shrink-0 items-center gap-1 rounded-card border border-border bg-input p-1 ${className}`}
    >
      {glider ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-1 h-6 rounded-inner bg-card-active shadow-card transition-transform duration-200 ease-out"
          style={{
            width: glider.width,
            transform: `translate3d(${glider.left}px, 0, 0)`,
          }}
        />
      ) : null}
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              if (el) btnRefs.current.set(option.value, el);
              else btnRefs.current.delete(option.value);
            }}
            type="button"
            aria-pressed={active}
            data-segmented-value={option.value}
            onClick={() => onChange(option.value)}
            className={`relative z-10 h-6 whitespace-nowrap rounded-inner px-3 text-caption transition-colors ${
              active
                ? `${glider ? '' : 'bg-card-active '}font-medium text-foreground`
                : 'text-secondary-foreground hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
