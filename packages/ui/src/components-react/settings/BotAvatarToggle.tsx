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
 * 勾选角标的语义。同样是判别联合：`locked` 与 `checked` 不可能分离。
 * - `checked`：普通勾选，用户可取消。
 * - `locked` ：恒真且不可取消（「保存时配置到」里的保存目标本身）。
 */
export type BotAvatarBadge = 'none' | 'checked' | 'locked';

/** 名称截断预算：全家族单一真值，两档尺寸共用。 */
const LABEL_MAX_UNITS = 10;

const SIZE = {
  regular: {
    cell: 'w-16 flex-col items-center gap-1 rounded-card py-1',
    face: 'size-11',
    glyph: 'size-6',
    badge: 'size-4 -bottom-1 -right-1',
    badgeGlyph: 'size-3',
    lockGlyph: 'size-2.5',
    name: 'w-full text-center',
    dimUnchecked: 'opacity-55',
  },
  compact: {
    cell: 'items-center gap-2 rounded-card px-1 py-2',
    face: 'size-8',
    glyph: 'size-4',
    badge: 'size-4 -bottom-1 -right-1',
    badgeGlyph: 'size-2.5',
    lockGlyph: 'size-2.5',
    name: 'max-w-32',
    dimUnchecked: '',
  },
} as const;

/**
 * Agent 头像选择格（唯一实现，两档尺寸）。
 *
 * 【设计意图 (Why)】
 *   「这个提供商配置到哪些 Bot」在设置里出现两处：提供商列表的「生效于」网格、
 *   添加端点弹框的「保存时配置到」。两处问的是同一个问题，只是作用时机不同
 *   （改既有绑定 / 建端点时一次写入）。它们必须是同一个组件的两档尺寸：
 *   列表页有充足垂直空间，用 44px 头像竖排；弹框高度受硬限，用 32px 头像横排，
 *   否则头像网格会把「保存」推出可达区。差异只允许是尺寸与排布，
 *   语义模型（状态、角标、截断、兜底）必须完全共用。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 「保存时配置到」曾是原生 12px 复选框 + 24 单位长名列表，与列表页的 44px 头像
 *      完全不是一套语言，用户在两处做的其实是同一个动作。
 *   2. 正方形卡片包一层边框会吃掉宽度，头像只能做到 24px，用户反馈"头像太小、
 *      外面那圈方框多余"。
 *   3. 首字母头像没有辨识度；无头像必须回落到 `BotIcon`，严禁退回首字母。
 *   4. 锁定态曾只靠 `disabled` 表达，而 `disabled` 的唯一视觉是鼠标光标；
 *      触屏与截图里锁定格与普通勾选格完全一样，用户读不出哪一个不可改。
 *   5. 锁定角标第一版用 `bg-secondary` 压在 `bg-card-active` 上，对比只有 1.27:1，
 *      8px 锁形在 1x 下糊成深色污渍——从"一模一样"变成"看不见"，同样不可接受。
 *      锁定必须比勾选更"定"：用反色底 + 前景色描边环，而不是更暗的实心底。
 *   6. 紧凑档曾写成同文件的第二份实现，结果截断预算（10 vs 12）与角标类串各漂一份，
 *      且把 `locked`/`checked` 重新拆成独立布尔，能表达"锁定但未勾选"这种非法态。
 *
 * 【约束与规则 (Rules)】
 *   1. 头像两档：regular 44px（格宽 64px，与 `agent-grid` 轨道同值）、compact 32px；
 *   2. 名称最多 10 个显示单位，完整名称留在 `title` 与 `aria-label`，截断不丢信息；
 *   3. 名称字号消费 `--ui-text-caption`（11px × 用户字号档位），不写死 px；
 *   4. 角标由 `badge` 单一枚举决定：`none` 无角标、`checked` 主色实心对号、
 *      `locked` 描边环锁形。`locked` 必须同时 `checked` 且 `disabled`，由调用方保证且类型可查；
 *   5. `state` 是判别联合，`current` 与 `failed` 不可能同时成立；
 *   6. 展开语义用 `expandable`，`controls` 与"可展开"从类型上成对，杜绝残缺 ARIA；
 *   7. 紧凑档热区高度不得低于 44px（触屏最小点击目标），靠 `py-1.5` 撑起；
 *   8. 间距只用 4px 网格整数档，不写 `gap-1.5` / `py-0.5` 这类小数；
 *   9. 组件不持有状态、不读快照，只接收派生好的值。
 */
export function BotAvatarToggle({
  profile,
  displayName,
  avatar,
  checked,
  disabled = false,
  badge = checked ? 'checked' : 'none',
  state = { kind: 'plain' },
  size = 'regular',
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
  /** 角标语义。省略时按 `checked` 推导为 `checked` 或 `none`。 */
  badge?: BotAvatarBadge;
  state?: BotAvatarState;
  size?: 'regular' | 'compact';
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
  const s = SIZE[size];
  const label = statusText ? `${displayName} · ${statusText}` : displayName;
  const current = state.kind === 'current';
  const failed = state.kind === 'failed';
  const showBadge = badge !== 'none' && checked;
  const compact = size === 'compact';
  return (
    <label
      title={label}
      data-agent-profile={profile}
      data-avatar-size={size}
      className={[
        'group flex',
        s.cell,
        'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground/70',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        dimmed ? 'opacity-60' : '',
        compact && checked ? 'bg-card-active' : '',
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
            'flex items-center justify-center overflow-hidden rounded-full bg-card-active',
            s.face,
            current ? 'ring-2 ring-success ring-offset-2 ring-offset-popover' : '',
            failed ? 'border-2 border-dashed border-destructive/60' : '',
            !checked && !failed ? s.dimUnchecked : '',
          ].join(' ')}
        >
          {avatar ? (
            <img src={avatar} alt="" className={`${s.face} object-cover`} />
          ) : (
            <BotIcon aria-hidden="true" className={`${s.glyph} text-muted-foreground`} />
          )}
        </span>
        {showBadge ? (
          <span
            aria-hidden="true"
            data-bot-badge={badge}
            className={[
              'absolute flex items-center justify-center rounded-full ring-2 ring-popover',
              s.badge,
              badge === 'locked'
                ? 'border-2 border-foreground bg-background text-foreground'
                : 'bg-primary text-primary-foreground',
            ].join(' ')}
          >
            {badge === 'locked' ? (
              <Lock aria-hidden="true" className={s.lockGlyph} strokeWidth={2.5} />
            ) : (
              <Check aria-hidden="true" className={s.badgeGlyph} strokeWidth={3} />
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
        className={[
          'truncate font-ui leading-tight',
          s.name,
          compact ? 'text-left' : '',
          current || badge === 'locked' ? 'font-semibold text-foreground' : 'font-medium text-secondary-foreground',
        ].join(' ')}
        style={{ fontSize: 'var(--ui-text-caption, var(--fs-caption))' }}
      >
        {truncateProfileLabel(displayName, LABEL_MAX_UNITS)}
      </span>
    </label>
  );
}

/** Agent 头像网格容器：与 `agent-grid` 同源，列数由可用宽度决定。 */
export function BotAvatarGrid({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="agent-grid">{children}</div>;
}
