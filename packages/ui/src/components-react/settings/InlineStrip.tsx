import * as React from 'react';

/**
 * 行内条：贴在某个列表行内部的浅底说明 + 控件区（唯一实现）。
 *
 * 【设计意图 (Why)】
 *   「在行内就地做一件事」的形态在本页出现三处：绑定确认条、提供商读取失败提示、
 *   订阅登录面板。它们的内距、圆角、底色与标题/提示的层级关系必须同源，否则同一页会
 *   漂出 px-2 / px-3 / p-3 三种横向内距与两套标题字阶。
 *
 * 【防范的历史坑 (Pitfall)】
 *   确认条第一版在被删掉的密钥输入块原位重写了一遍容器类串，于是同一个文件里出现
 *   两份 `flex flex-col gap-2 rounded-panel border border-border-subtle bg-panel`。
 *
 * 【约束与规则 (Rules)】
 *   1. 横向内距统一 12px（`px-3`）、纵向 8px（`py-2`），与 `agent-grid` 的 8px 列间距同族；
 *   2. 标题用 `text-body` + `font-medium`，提示用 `text-caption` + `text-muted-foreground`；
 *   3. `role="group"` + `aria-labelledby` 让屏幕阅读器知道"这一条在问什么"，
 *      没有标题的调用方传 `label` 走 `aria-label`；
 *   4. `busy` 只映射到 `aria-busy`，不禁用任何控件——禁用是控件自己的语义。
 */
export function InlineStrip({
  id,
  titleId,
  title,
  hint,
  label,
  busy = false,
  children,
}: {
  id?: string;
  titleId?: string;
  title?: string;
  hint?: string;
  /** 没有可见标题时的可访问名称。 */
  label?: string;
  busy?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      id={id}
      role="group"
      aria-labelledby={titleId}
      aria-label={titleId ? undefined : label}
      aria-busy={busy || undefined}
      className="flex flex-col gap-2 rounded-panel border border-border-subtle bg-panel px-3 py-2"
    >
      {title || hint ? (
        <div className="flex flex-col gap-1">
          {title ? (
            <span id={titleId} className="text-body font-medium text-foreground">
              {title}
            </span>
          ) : null}
          {hint ? <span className="text-caption text-muted-foreground">{hint}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
