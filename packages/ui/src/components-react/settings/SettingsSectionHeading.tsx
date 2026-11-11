import * as React from 'react';

/**
 * 设置分区标题（唯一实现）。
 *
 * 【设计意图 (Why)】
 *   设置页每个分区都是「标题 + 一句解释」。标题与解释若横排对撞，中文解释一长就会把
 *   标题挤成省略号——用户看到的第一件事变成读不完整的句子。这里固定为上下结构：
 *   标题独占一行，解释在下一行可换行。
 *
 * 【约束与规则 (Rules)】
 *   1. 标题字阶 `text-section`（14px/500），解释字阶 `text-caption`（11px/500）；
 *   2. 解释允许换行，不 `truncate`，不做单行椭圆；
 *   3. `meta` 是可选计数徽标，钉在标题右侧，不参与宽度竞争。
 */
export function SettingsSectionHeading({
  title,
  hint,
  meta,
}: {
  title: string;
  hint?: string;
  meta?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mb-2 flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-section font-medium text-foreground">{title}</h3>
        {meta ? <span className="shrink-0 text-caption text-muted-foreground">{meta}</span> : null}
      </div>
      {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
