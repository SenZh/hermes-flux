import * as React from 'react';
import { Bot as BotIcon, Check, Lock } from 'lucide-react';
import { truncateProfileLabel } from '@hermes-flux/core';
import { t } from '../../i18n/index.js';

/**
 * 头像格的两种状态。用判别联合而不是布尔组合，非法态在类型上不可表达。
 * - `plain`  ：普通格（开启 / 未开启 / 当前默认统一由 `badge` 区分）。
 * - `failed` ：该 Bot 与这一项的关系读取失败（虚线红边 + 红点 + 原因）。
 */
export type BotAvatarState =
  | { kind: 'plain' }
  | { kind: 'failed'; reason: string };

/**
 * 勾选角标的语义。同样是判别联合：`locked`、`default` 与 `checked` 不可能同时错配。
 * - `checked`：普通勾选，用户可直接取消。
 * - `default`：当前默认提供方（名字下方「默认」微标），点击将弹出切换默认窗口。
 * - `locked` ：恒真且不可取消（「保存时配置到」里的保存目标本身）。
 */
export type BotAvatarBadge = 'none' | 'checked' | 'locked' | 'default';

/** 名称截断预算：112px 宽轨道下支持 16 显示单位（如 `flux-product` / 8 个汉字）。 */
const LABEL_MAX_UNITS = 16;

const SIZE = {
  regular: {
    cell: 'w-28 flex-col items-center gap-2 rounded-card border border-transparent px-1 py-2 transition-colors',
    face: 'size-14',
    glyph: 'size-7',
    badge: 'size-5 -bottom-1 -right-1',
    badgeGlyph: 'size-3',
    lockGlyph: 'size-3',
    name: 'w-full text-center',
    dimUnchecked: 'opacity-50',
  },
  compact: {
    cell: 'items-center gap-2 rounded-card px-1 py-2',
    face: 'size-8',
    glyph: 'size-4',
    badge: 'size-4 -bottom-1 -right-1',
    badgeGlyph: 'size-3',
    lockGlyph: 'size-3',
    name: 'max-w-36',
    dimUnchecked: '',
  },
} as const;

/**
 * Agent 头像选择格（唯一实现，两档尺寸）。
 *
 * 【设计意图 (Why)】
 *   「这个提供商配置到哪些 Bot」在设置里出现两处：提供商列表的成员网格、
 *   添加端点弹框的「启用 BOT」。两处问的是同一个问题，只是作用时机不同
 *   （改既有绑定 / 建端点时一次写入）。它们必须是同一个组件的两档尺寸：
 *   列表页有充足空间，用 56px 头像竖排宽格，保证常用中英文名称完整可读；
 *   弹框高度受硬限，用 32px 头像横排，否则头像网格会把「保存」推出可达区。
 *   差异只允许是尺寸与排布，语义模型（状态、角标、截断、兜底）必须完全共用。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 「保存时配置到」曾是原生 12px 复选框 + 24 单位长名列表，与列表页的头像网格完全不是一套语言。
 *   2. 64px 窄轨 + 44px 头像曾导致 `flux-product`、`xiaofawang` 等常规名全被腰斩，且默认徽章盖在头像半张脸上。
 *   3. 首字母头像没有辨识度；无头像必须回落到 `BotIcon`，严禁退回首字母。
 *   4. 锁定角标用反色描边环，保证 1x 下与普通对号清晰可辨。
 *
 * 【约束与规则 (Rules)】
 *   1. 头像两档：regular 56px（格宽 112px，与 `agent-grid` 轨道同值）、compact 32px；
 *   2. 名称最多 16 个显示单位，完整名称留在 `title` 与 `aria-label`，截断不丢信息；
 *   3. 名称字号消费 `--ui-text-caption`（11px × 用户字号档位），不写死 px；
 *   4. 角标由 `badge` 单一枚举决定：`none` 无角标、`checked` 主色实心对号、
 *      `default` 名字下方「默认」微标（不遮脸）、`locked` 描边环锁形；
 *   5. `state` 是判别联合，当前默认由 `badge="default"` 表达，已无 `current` 绿环态；
 *   6. 展开语义用 `expandable`，`controls` 与"可展开"从类型上成对，杜绝残缺 ARIA；
 *   7. 紧凑档热区高度不得低于 44px（触屏最小点击目标），靠 `py-2` 撑起；
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
  /** 追加到可访问名称后的状态说明，例如"当前默认提供方"或错误原因。 */
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
  const failed = state.kind === 'failed';
  const compact = size === 'compact';
  const showCornerBadge =
    checked && (badge === 'locked' || badge === 'checked' || (badge === 'default' && !disabled));
  const showOffIndicator = !checked && !disabled && !failed && !compact;
  const nameNode = (
    <span
      className={[
        'truncate font-ui leading-tight',
        s.name,
        compact ? 'text-left' : '',
        badge === 'locked' || badge === 'default'
          ? 'font-semibold text-foreground'
          : !checked && !failed
            ? 'font-medium text-muted-foreground'
            : 'font-medium text-secondary-foreground',
      ].join(' ')}
      style={{ fontSize: 'var(--ui-text-caption, var(--fs-caption))' }}
    >
      {truncateProfileLabel(displayName, LABEL_MAX_UNITS)}
    </span>
  );
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
        !disabled && !compact ? 'hover:border-border-subtle hover:bg-card-hover' : '',
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
      {/* 头像本身就是勾选面：56px 竖排格把「默认」移至名字下方，绝不遮挡头像脸部。 */}
      <span className="relative">
        <span
          className={[
            'flex items-center justify-center overflow-hidden rounded-full bg-card-active',
            s.face,
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
        {showCornerBadge ? (
          <span
            aria-hidden="true"
            data-bot-badge={badge === 'default' ? undefined : badge}
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
        ) : showOffIndicator ? (
          <span
            aria-hidden="true"
            className={[
              'absolute rounded-full border border-dashed border-muted-foreground bg-card',
              s.badge,
            ].join(' ')}
          />
        ) : null}
        {failed ? (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 size-2 rounded-full bg-destructive ring-2 ring-popover"
          />
        ) : null}
      </span>
      {compact ? (
        nameNode
      ) : (
        <span className="flex w-full flex-col items-center gap-1">
          {nameNode}
          {checked && badge === 'default' ? (
            <span
              aria-hidden="true"
              data-bot-badge="default"
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-warning/40 bg-popover px-2 text-micro font-semibold text-foreground"
            >
              <span className="size-1 shrink-0 rounded-full bg-warning" />
              <span>{t('settings.agentDefault')}</span>
            </span>
          ) : null}
        </span>
      )}
    </label>
  );
}

/** Agent 头像网格容器：与 `agent-grid` 同源，列数由可用宽度决定。 */
export function BotAvatarGrid({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="agent-grid">{children}</div>;
}
