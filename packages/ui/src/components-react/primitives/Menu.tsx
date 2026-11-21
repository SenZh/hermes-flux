import * as React from 'react';
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;
export const MenuGroup = MenuPrimitive.Group;
export const MenuPortal = MenuPrimitive.Portal;
export const MenuSub = MenuPrimitive.Sub;
export const MenuRadioGroup = MenuPrimitive.RadioGroup;

export const MenuContent = React.forwardRef<React.ElementRef<typeof MenuPrimitive.Content>, React.ComponentPropsWithoutRef<typeof MenuPrimitive.Content>>(
  ({ className, sideOffset = 4, ...props }, ref) => (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        ref={ref}
        data-flux-island=""
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-32 overflow-hidden rounded-panel border border-border-strong surface-raised specular-top p-1 text-foreground shadow-window',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  ),
);
MenuContent.displayName = MenuPrimitive.Content.displayName;

export const MenuItem = React.forwardRef<React.ElementRef<typeof MenuPrimitive.Item>, React.ComponentPropsWithoutRef<typeof MenuPrimitive.Item>>(
  ({ className, ...props }, ref) => (
    <MenuPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex cursor-default select-none items-center rounded-card px-2 py-2 text-body outline-none focus:bg-card-hover focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
MenuItem.displayName = MenuPrimitive.Item.displayName;

/**
 * 单选菜单项：必须与 MenuRadioGroup 配合使用。
 *
 * 【设计意图】选中态不能只靠一个 Check 图标——那样屏幕阅读器完全读不到"当前选中项"。
 *   Radix 的 RadioItem 自带 `role="menuitemradio"` 与 `aria-checked`，
 *   ItemIndicator 负责在选中时渲染指示器。
 * 【约束与规则】本组件只接受 `value`，不接受自绘选中图标；禁止在 children 里再画 Check。
 */
export const MenuRadioItem = React.forwardRef<React.ElementRef<typeof MenuPrimitive.RadioItem>, React.ComponentPropsWithoutRef<typeof MenuPrimitive.RadioItem>>(
  ({ className, children, ...props }, ref) => (
    <MenuPrimitive.RadioItem
      ref={ref}
      className={cn(
        'relative flex cursor-default select-none items-center rounded-inner py-1 pl-6 pr-2 text-body outline-none focus:bg-accent focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Check aria-hidden="true" className="size-3 text-primary" strokeWidth={2.5} />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  ),
);
MenuRadioItem.displayName = MenuPrimitive.RadioItem.displayName;
