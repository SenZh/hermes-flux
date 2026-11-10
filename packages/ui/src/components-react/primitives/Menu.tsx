import * as React from 'react';
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '../../lib/utils.js';

export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;
export const MenuGroup = MenuPrimitive.Group;
export const MenuPortal = MenuPrimitive.Portal;
export const MenuSub = MenuPrimitive.Sub;
export const MenuRadioGroup = MenuPrimitive.RadioGroup;

export const MenuContent = React.forwardRef<React.ElementRef<typeof MenuPrimitive.Content>, React.ComponentPropsWithoutRef<typeof MenuPrimitive.Content>>(
  ({ className, sideOffset = 4, ...props }, ref) => <MenuPrimitive.Portal><MenuPrimitive.Content ref={ref} sideOffset={sideOffset} className={cn('z-50 min-w-32 overflow-hidden rounded-card border border-border bg-popover p-1 text-foreground shadow-window', className)} {...props} /></MenuPrimitive.Portal>
);
MenuContent.displayName = MenuPrimitive.Content.displayName;

export const MenuItem = React.forwardRef<React.ElementRef<typeof MenuPrimitive.Item>, React.ComponentPropsWithoutRef<typeof MenuPrimitive.Item>>(
  ({ className, ...props }, ref) => <MenuPrimitive.Item ref={ref} className={cn('relative flex cursor-default select-none items-center rounded-inner px-2 py-1.5 text-body outline-none focus:bg-accent focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className)} {...props} />
);
MenuItem.displayName = MenuPrimitive.Item.displayName;
