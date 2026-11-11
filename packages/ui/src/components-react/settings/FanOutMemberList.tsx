import * as React from 'react';
import { truncateProfileLabel } from '@hermes-flux/core';
import type { SettingsBotRow } from './settingsModel.js';

/**
 * 添加/编辑端点时的「保存时配置到」成员列表。
 *
 * 【设计意图 (Why)】
 *   这是全宽、可换行的勾选列表，可用宽度远大于 64px 成员格；成员格的 10 单位预算
 *   会把超过 10 字符的名字（如 `auralis-infrastructure-ops`）截断，这里没有这个约束。
 *   抽成独立组件是为了让 SSR 测试能直接渲染并钉住「名称 + title + 勾选态」三条契约。
 *
 * 【约束与规则 (Rules)】
 *   1. 预算 24 单位（≈149px + 12px 勾选框 + 4px 间距 ≈ 165px）只为极端长名兜底；
 *      更长的名字仍会在列表内换行，不横向溢出；
 *   2. `title` 与勾选框 `aria-label` 保留完整名称，截断不得丢信息；
 *   3. 只做勾选展示与回调，不持有状态、不读快照。
 */
const FAN_OUT_LABEL_MAX_UNITS = 24;

export function FanOutMemberList({
  bots,
  selected,
  onToggle,
}: {
  bots: readonly SettingsBotRow[];
  selected: readonly string[];
  onToggle: (profile: string) => void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-2">
      {bots.map((bot) => (
        <label
          key={bot.profile}
          title={bot.displayName}
          className="flex items-center gap-1 py-1 text-caption text-secondary-foreground"
        >
          <input
            type="checkbox"
            className="size-3 shrink-0 accent-primary"
            aria-label={bot.displayName}
            checked={selected.includes(bot.profile)}
            onChange={() => onToggle(bot.profile)}
          />
          {truncateProfileLabel(bot.displayName, FAN_OUT_LABEL_MAX_UNITS)}
        </label>
      ))}
    </div>
  );
}
