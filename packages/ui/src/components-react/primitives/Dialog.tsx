import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../lib/utils.js';

/*
 * Dialog — 模态浮层族的唯一合法实现。
 *
 * 设计意图(Why)：
 *   模态层不是一个"半透明黑底 + 居中白框"，而是一组不可拆的物理与行为属性：
 *   唯一遮罩档（backdrop/80）、焦点陷阱、Esc 分层关闭、滚动锁定、关闭后焦点归还。
 *   把这组属性收进组件后，业务只能决定"内容长什么样"，不可能再拼出
 *   "遮罩 40% 的二级弹窗 + 没有焦点陷阱的三级弹窗"这种物理上不存在的层级。
 *
 * 防范的历史坑(Pitfall)：
 *   1. 设置中心三处弹窗各自手写 `fixed inset-0 bg-backdrop/40|/60|/80`，同一屏出现三种遮罩；
 *   2. 二级弹窗只在自身容器上 onKeyDown 拦 Esc，焦点停在触发按钮上时事件根本不经过容器，
 *      一次 Esc 连外层设置页一起关掉，已填表单全丢；
 *   3. 手写弹窗没有焦点陷阱，Tab 会把焦点送出弹窗外落到主界面。
 *
 * 约束与规则(Rules)：
 *   1. 遮罩只有一档 bg-backdrop/80，业务不得覆盖（overlayClassName 只允许调 padding 之外的定位语义）；
 *   2. 内容框默认几何（max-w-lg / p-6 / gap-4）可被业务 className 覆盖，但圆角与阴影不可覆盖；
 *   3. `portal` 默认 true；设置中心必须传 false —— 它依赖 .flux-settings 控件基线作用域，
 *      且既有静态渲染用例要求内容出现在同一棵 SSR 树里，Portal 在服务端渲染为空。
 *   4. 嵌套弹窗（设置中心 → 添加提供商 / 模型列表 / 离场确认）必须各自使用本组件：
 *      Radix 的 DismissableLayer 栈保证 Esc 只关闭最上层，这是 Esc 穿透的唯一根治方式。
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export const DialogOverlay = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>(
  ({ className, ...props }, ref) => <DialogPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-50 bg-backdrop/80', className)} {...props} />
);
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

export interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** 是否把内容 Portal 到 body。设置中心传 false，见上方规则 3。 */
  portal?: boolean;
  /** 遮罩附加类；只用于调整层级或定位，不得改底色档位。 */
  overlayClassName?: string;
}

export const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  function DialogContent({ className, children, portal = true, overlayClassName, ...props }, ref) {
    const body = (
      <>
        <DialogOverlay className={overlayClassName} />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-window border border-border bg-popover p-6 text-foreground shadow-window focus:outline-none',
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </>
    );
    return portal ? <DialogPortal>{body}</DialogPortal> : body;
  },
);
DialogContent.displayName = DialogPrimitive.Content.displayName;
