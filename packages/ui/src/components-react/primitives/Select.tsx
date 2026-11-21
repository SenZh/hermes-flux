import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { type VariantProps } from 'class-variance-authority';
import { selectTriggerVariants } from '../../lib/selectTrigger.js';
import { cn } from '../../lib/utils.js';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from './Menu.js';

/*
 * Select — 单选下拉的唯一合法实现。
 *
 * 设计意图(Why)：
 *   原生 <select> 的弹出列表由操作系统绘制，深色皮肤下会弹出白色系统列表，
 *   而且无法承载厂商图标、分组标题与可读名。把"触发器 + 单选列表"收进一个原语后，
 *   设置中心的字体选择、BOT 模型绑定、端点默认模型共用同一形态与同一键盘行为。
 *
 * 防范的历史坑(Pitfall)：
 *   1. 三套互不兼容的下拉（原生 + appearance-none + Radix Menu）并存，圆角 4px 与 6px 混用；
 *   2. 每个下拉各自写 z-index，Portal 出去后被设置弹窗盖住；
 *   3. 分组标题用 optgroup，深色模式下不可样式化。
 *
 * 约束与规则(Rules)：
 *   1. 触发器几何与 Input 同源（rounded-card / border-border / bg-input / focus ring），尺寸档共用 default|sm|xs；
 *   2. 下拉内容必须经 MenuContent（Radix Portal），层级统一在 z-1200，高于设置弹窗 z-50；
 *   3. 选中项用 Check 图标表达，不依赖颜色单一通道；
 *   4. 文案全部由调用方传入，本组件不引入任何 i18n key。
 */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectGroup {
  /** 分组标题；只有一个分组时传空串，不渲染标题行。 */
  label: string;
  options: readonly SelectOption[];
}

export interface SelectProps extends VariantProps<typeof selectTriggerVariants> {
  /** 触发器 id；用于测试定位与外部 label 关联（button 非 labelable，关联只作定位）。 */
  id?: string;
  value: string;
  groups: readonly SelectGroup[];
  onChange: (value: string) => void;
  ariaLabel: string;
  /** 无匹配项时触发器上的占位文案。 */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** 自定义选项内容（图标 + 可读名）；缺省渲染 label。 */
  renderOption?: (option: SelectOption) => React.ReactNode;
  /** 自定义触发器内容（与选项同一套视觉）；缺省渲染当前项 label。 */
  renderValue?: (value: string, current: SelectOption | null) => React.ReactNode;
  /** 下拉面板宽度类，默认 w-72。 */
  contentClassName?: string;
}

export function Select({
  id,
  value,
  groups,
  onChange,
  ariaLabel,
  placeholder,
  disabled = false,
  size,
  className,
  renderOption,
  renderValue,
  contentClassName,
}: SelectProps): React.ReactElement {
  const options = React.useMemo(() => groups.flatMap((group) => group.options), [groups]);
  const current = options.find((option) => option.value === value) ?? null;
  const showGroupTitles = groups.length > 1;

  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" id={id} aria-label={ariaLabel} disabled={disabled} className={cn(selectTriggerVariants({ size }), className)}>
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
            {renderValue ? (
              renderValue(value, current)
            ) : (
              <span className={cn('min-w-0 flex-1 truncate', current ? 'text-foreground' : 'text-muted-foreground')}>
                {current ? current.label : placeholder ?? ''}
              </span>
            )}
          </span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </MenuTrigger>
      {/* 下拉经 Radix Portal 挂到 body，用语义档位 z-menu 高于设置弹窗宿主 */}
      <MenuContent align="start" className={cn('z-menu max-h-64 overflow-y-auto', contentClassName ?? 'w-72')}>
        <MenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next !== value) onChange(next);
          }}
        >
          {groups.map((group, groupIndex) => (
            <React.Fragment key={`${group.label}:${groupIndex}`}>
              {showGroupTitles && group.label ? (
                <div className="px-2 py-1 text-micro text-muted-foreground" role="presentation">
                  {group.label}
                </div>
              ) : null}
              {group.options.map((option) => (
                <MenuRadioItem
                  key={`${group.label}:${groupIndex}:${option.value}`}
                  value={option.value}
                  disabled={option.disabled}
                  className="flex items-center gap-2"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {renderOption ? renderOption(option) : <span className="min-w-0 flex-1 truncate text-caption">{option.label}</span>}
                  </span>
                </MenuRadioItem>
              ))}
            </React.Fragment>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

export { selectTriggerVariants };
