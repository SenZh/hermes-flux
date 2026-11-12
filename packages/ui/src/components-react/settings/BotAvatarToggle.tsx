import * as React from 'react';
import { Bot as BotIcon, Check, Lock } from 'lucide-react';
import { truncateProfileLabel } from '@hermes-flux/core';

/**
 * 头像格的三种状态。用判别联合而不是两个布尔，非法组合在类型上不可表达。
 * - `plain`  ：普通格。
 * - `current`：该 Bot 的默认提供商就是这一项（绿环）。
 * - `failed` ：该 Bot 与这一项的关系读取失败（虚线红边 + 红点 + 原因）。
 */
export type BotAvatarState =
  | { kind: 'plain' }
  | { kind: 'current' }
  | { kind: 'failed'; reason: string };

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
 *   4. 锁定态曾只靠 `disabled` 表达，而 `disabled` 的唯一视觉是鼠标光标；触屏与截图里
 *      锁定格与普通勾选格完全一样，用户读不出哪一个不可改。锁定必须有独立视觉。
 *
 * 【约束与规则 (Rules)】
 *   1. 头像恒为 44px，格宽恒为 64px（与 `agent-grid` 轨道同值，改一处必须同步另一处）；
 *   2. 名称最多 10 个显示单位，完整名称留在 `title` 与 `aria-label`，截断不丢信息；
 *   3. 名称字号消费 `--ui-text-caption`（11px × 用户字号档位），不写死 px；
 *   4. 勾选态用压在右下角的对号表达；`current` 用 success 环表达默认提供商；
 *   5. `locked` 用锁形角标替代对号：这是"恒真且不可取消"的第三种语义，不能与勾选共用一套图形；
 *   6. `state` 是判别联合，`current` 与 `failed` 不可能同时成立；
 *   7. 展开语义用 `expandable`，`controls` 与"可展开"从类型上成对，杜绝残缺 ARIA；
 *   8. 组件不持有状态、不读快照，只接收派生好的值。
 */
export function BotAvatarToggle({
  profile,
  displayName,
  avatar,
  checked,
  disabled = false,
  locked = false,
  state = { kind: 'plain' },
  dimmed = false,
  statusText,
  expandable,
  onToggle,
}: {
  profile: string;
  displayName: string;
  avatar?: string;
  checked: boolean;
  disabled?: boolean;
  /** 恒真且不可取消（例如「保存时配置到」里的保存目标本身）。 */
  locked?: boolean;
  state?: BotAvatarState;
  dimmed?: boolean;
  /** 追加到可访问名称后的状态说明，例如"当前模型"或错误原因。 */
  statusText?: string;
  /**
   * 点击后在下方展开了一个面板时传入。
   * 【规则】`controls` 与"可展开"必须成对：ARIA 1.2 允许 `checkbox` 携带 `aria-expanded`，
   *   但"已展开却指向不存在的面板"会让读屏宣告一个空目标，因此用对象而不是两个独立可选参数。
   */
  expandable?: { controls: string };
  onToggle: () => void;
}): React.ReactElement {
  const label = statusText ? `${displayName} · ${statusText}` : displayName;
  const current = state.kind === 'current';
  const failed = state.kind === 'failed';
  return (
    <label
      title={label}
      data-agent-profile={profile}
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
        aria-expanded={expandable ? true : undefined}
        aria-controls={expandable?.controls}
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
            data-bot-badge={locked ? 'locked' : 'checked'}
            className={[
              'absolute -bottom-1 -right-1 flex items-center justify-center rounded-full ring-2 ring-popover',
              locked
                ? 'size-4 bg-secondary text-secondary-foreground'
                : 'size-4 bg-primary text-primary-foreground',
            ].join(' ')}
          >
            {locked ? (
              <Lock aria-hidden="true" className="size-2.5" strokeWidth={2.5} />
            ) : (
              <Check aria-hidden="true" className="size-3" strokeWidth={2.5} />
            )}
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

/**
 * 紧凑变体：32px 头像 + 单行名，用于弹框这类垂直空间紧张的场景。
 *
 * 【设计意图 (Why)】
 *   添加端点弹框的高度受 `max-h-[min(680px, …)]` 硬限，而字段本身已经占满一屏；
 *   这里若沿用列表页的 44px 头像 + 双行节奏，头像网格会把「测试端点 / 保存」推到
 *   滚动区外，用户以为弹框没有保存按钮。
 *   紧凑变体保留同一套语义（勾选角标、锁形角标、名称截断、BotIcon 兜底），
 *   只压缩尺寸，因此两处仍然是同一个组件的两种规格，而不是两套实现。
 *
 * 【约束与规则 (Rules)】
 *   1. 头像 32px、格宽 48px、名称与头像同排（横向），总高约 32px；
 *   2. 勾选角标压到 12px，锁形角标同样缩小，语义不变；
 *   3. 只允许在垂直受限的容器里使用；列表页必须用标准规格，避免主次颠倒。
 */
export function BotAvatarChip({
  profile,
  displayName,
  avatar,
  checked,
  disabled = false,
  locked = false,
  statusText,
  onToggle,
}: {
  profile: string;
  displayName: string;
  avatar?: string;
  checked: boolean;
  disabled?: boolean;
  locked?: boolean;
  statusText?: string;
  onToggle: () => void;
}): React.ReactElement {
  const label = statusText ? `${displayName} · ${statusText}` : displayName;
  return (
    <label
      title={label}
      data-agent-profile={profile}
      className={[
        'flex items-center gap-1.5 rounded-card py-0.5 pr-1.5',
        'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground/70',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        checked ? 'bg-card-active' : '',
      ].join(' ')}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={onToggle}
      />
      <span className="relative">
        <span className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-card-active">
          {avatar ? (
            <img src={avatar} alt="" className="size-8 object-cover" />
          ) : (
            <BotIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          )}
        </span>
        {checked ? (
          <span
            aria-hidden="true"
            data-bot-badge={locked ? 'locked' : 'checked'}
            className={[
              'absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full ring-2 ring-popover',
              locked ? 'bg-secondary text-secondary-foreground' : 'bg-primary text-primary-foreground',
            ].join(' ')}
          >
            {locked ? (
              <Lock aria-hidden="true" className="size-2" strokeWidth={2.5} />
            ) : (
              <Check aria-hidden="true" className="size-2" strokeWidth={3} />
            )}
          </span>
        ) : null}
      </span>
      <span
        className={`max-w-28 truncate font-ui leading-tight ${
          locked ? 'font-semibold text-foreground' : 'font-medium text-secondary-foreground'
        }`}
        style={{ fontSize: 'var(--ui-text-caption, var(--fs-caption))' }}
      >
        {truncateProfileLabel(displayName, 12)}
      </span>
    </label>
  );
}
