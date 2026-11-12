import * as React from 'react';
import { Bot as BotIcon, Check } from 'lucide-react';
import { truncateProfileLabel } from '@hermes-flux/core';

/**
 * Agent 头像选择格（唯一实现）。
 *
 * 【设计意图 (Why)】
 *   「这个提供商配置到哪些 Bot」在设置里出现两处：提供商列表的「生效于」网格、
 *   添加端点弹框的「保存时配置到」。两处问的是同一个问题，只是作用时机不同
 *   （改既有绑定 / 建端点时一次写入）。若各写一套，头像尺寸、勾选位置、名称截断、
 *   无头像兜底会立刻漂成两种观感，用户还得重新辨认「这次是勾选框还是头像」。
 *   本组件是这两处的唯一落点：调用方负责状态语义，本组件只负责长相。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 「保存时配置到」曾是原生 12px 复选框 + 24 单位长名列表，与列表页的 44px 头像
 *      完全不是一套语言，用户在两处做的其实是同一个动作。
 *   2. 正方形卡片包一层边框会吃掉宽度，头像只能做到 24px，用户反馈"头像太小、
 *      外面那圈方框多余"。
 *   3. 首字母头像没有辨识度；无头像必须回落到 `BotIcon`，严禁退回首字母。
 *
 * 【约束与规则 (Rules)】
 *   1. 头像恒为 44px，格宽恒为 64px（与 `agent-grid` 轨道同值，改一处必须同步另一处）；
 *   2. 名称最多 10 个显示单位，完整名称留在 `title` 与 `aria-label`，截断不丢信息；
 *   3. 名称字号消费 `--ui-text-caption`（11px × 用户字号档位），不写死 px；
 *   4. 勾选态用压在右下角的对号表达；`current` 用 success 环表达"该 Bot 的默认提供商"；
 *   5. `failed` 用虚线红边 + 右上红点，与 `current` 语义互斥，绝不混用；
 *   6. 组件不持有状态、不读快照，只接收派生好的布尔值与回调。
 */
export function BotAvatarToggle({
  profile,
  displayName,
  avatar,
  checked,
  disabled = false,
  current = false,
  failed = false,
  dimmed = false,
  statusText,
  expanded,
  controls,
  onToggle,
}: {
  profile: string;
  displayName: string;
  avatar?: string;
  checked: boolean;
  disabled?: boolean;
  /** 该 Bot 的默认提供商就是当前这一项（绿环）。 */
  current?: boolean;
  /** 该 Bot 与当前提供商的关系读取失败（虚线红边）。 */
  failed?: boolean;
  dimmed?: boolean;
  /** 追加到可访问名称后的状态说明，例如"当前模型"或错误原因。 */
  statusText?: string;
  /** 点击后在下方展开了一个面板时传布尔值；否则留空，不声明可展开语义。 */
  expanded?: boolean;
  /** 展开面板的 `id`，与 `expanded` 成对使用。 */
  controls?: string;
  onToggle: () => void;
}): React.ReactElement {
  const label = statusText ? `${displayName} · ${statusText}` : displayName;
  return (
    <label
      title={label}
      data-agent-profile={profile}
      data-agent-current={current ? 'true' : undefined}
      data-agent-failed={failed ? 'true' : undefined}
      className={[
        'group flex w-16 flex-col items-center gap-1 rounded-card py-1',
        'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground/70',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        dimmed ? 'opacity-60' : '',
      ].join(' ')}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        aria-expanded={expanded}
        aria-controls={expanded === undefined ? undefined : controls}
        onChange={onToggle}
      />
      {/* 头像本身就是勾选面：不外包正方形卡片，把有限宽度让给头像和名字。 */}
      <span className="relative">
        <span
          className={[
            'flex size-11 items-center justify-center overflow-hidden rounded-full bg-card-active',
            current ? 'ring-2 ring-success ring-offset-2 ring-offset-popover' : '',
            failed ? 'border-2 border-dashed border-destructive/60' : '',
            checked || failed ? '' : 'opacity-55',
          ].join(' ')}
        >
          {avatar ? (
            <img src={avatar} alt="" className="size-11 object-cover" />
          ) : (
            <BotIcon aria-hidden="true" className="size-6 text-muted-foreground" />
          )}
        </span>
        {checked ? (
          <span
            aria-hidden="true"
            className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-popover"
          >
            <Check aria-hidden="true" className="size-3" strokeWidth={2.5} />
          </span>
        ) : null}
        {failed ? (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 size-2 rounded-full bg-destructive ring-2 ring-popover"
          />
        ) : null}
      </span>
      <span
        className={`w-full truncate text-center font-ui leading-tight ${
          current ? 'font-semibold text-foreground' : 'font-medium text-secondary-foreground'
        }`}
        style={{ fontSize: 'var(--ui-text-caption, var(--fs-caption))' }}
      >
        {truncateProfileLabel(displayName)}
      </span>
    </label>
  );
}

/** Agent 头像网格容器：与 `agent-grid` 同源，列数由可用宽度决定。 */
export function BotAvatarGrid({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="agent-grid">{children}</div>;
}
