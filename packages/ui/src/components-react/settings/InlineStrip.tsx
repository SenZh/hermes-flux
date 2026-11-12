import * as React from 'react';

/**
 * 行内条：贴在某个列表行内部的浅底说明 + 控件区。
 *
 * 【设计意图 (Why)】
 *   「在行内就地做一件事」的形态在本页有两处真实消费：绑定确认条与订阅登录面板。
 *   它们的内距、圆角、底色与标题/提示的层级关系必须同源，否则同一页会漂出
 *   px-2 / px-3 / p-3 三种横向内距与两套标题字阶。提供商读取失败提示是多行告警列表，
 *   形态不同，仍由调用方自行渲染。
 *
 * 【防范的历史坑 (Pitfall)】
 *   确认条第一版在被删掉的密钥输入块原位重写了一遍容器类串，于是同一个文件里出现
 *   两份 `flex flex-col gap-2 rounded-panel border border-border-subtle bg-panel`。
 *
 * 【约束与规则 (Rules)】
 *   1. 横向内距统一 12px（`px-3`）、纵向 8px（`py-2`），与 `agent-grid` 的 8px 列间距同族；
 *   2. 标题用 `text-body` + `font-medium`，提示用 `text-caption` + `text-muted-foreground`；
 *   3. `role="group"` 必须有名字：`title`+`titleId` 成对，或退到 `label`，
 *      三者都不给就是无名分组，读屏只会念"组"；
 *   4. `busy` 只映射到 `aria-busy`，不禁用任何控件——禁用是控件自己的语义。
 */
type InlineStripHeading =
  | { title: string; titleId: string; label?: never }
  | { title?: never; titleId?: never; label: string };

export function InlineStrip({
  id,
  hint,
  busy = false,
  children,
  ...heading
}: InlineStripHeading & {
  id?: string;
  hint?: string;
  busy?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const title = heading.title;
  const titleId = heading.titleId;
  const label = heading.label;
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
