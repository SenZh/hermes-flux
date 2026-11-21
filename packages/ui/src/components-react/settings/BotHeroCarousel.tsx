import * as React from 'react';
import { PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import type { BotDraftState } from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import { presentModel } from '../../lib/modelPresentation.js';
import { renderBotAvatar } from '../../utils/botAvatar.js';
import { Badge } from '../primitives/Badge.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import { Tooltip } from '../primitives/Tooltip.js';
import {
  filterBotRoster,
  resolveBotAvatar,
  resolveBotCardSubtitle,
  resolveBotDisplayTitle,
  resolveCarouselKeyTarget,
  resolveFocusableBotId,
} from './botPanelLogic.js';
import type { BotRosterEntry } from './settingsModel.js';

/**
 * BOT 成员垂直选择微轨（方案 1：默认 56px 纯头像微轨，底部开关平滑展开名单）。
 *
 * 【设计意图 (Why)】
 *   设置中心左侧已有一级主导航栏，若再并列一条常驻宽名单栏会产生"双层侧栏"压迫感，
 *   而旧版顶部横向砖块墙在少人/多人与宽窄屏下均显笨重。改为紧贴左边界的 56px 纯头像
 *   微轨：默认把 90%+ 空间还给右侧工作台；悬停头像经极客 Tooltip 弹出"名称 · 模型"轻量
 *   名片；点击底部标准 `PanelLeftOpen`/`PanelLeftClose` 图标（禁止箭头）可平滑展开为
 *   208px 带搜索框的完整名单列。选中态通过 GPU 垂直磁吸光柱与滑块表达，头像永远零外圈。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 头像容器缺 `shrink-0` / `aspect-square` 时会被 flex 压成椭圆，必须硬锁定 1:1 正圆；
 *   2. 头像外围加 `ring-2` 会与内置描边叠成靶心圈，视觉生硬且违反用户明确要求；
 *   3. 折叠开关用 `<` / `>` 箭头语义模糊、像翻页键，改用 `PanelLeftOpen`/`PanelLeftClose` 并置底；
 *   4. 使用原生 `title` 会弹出 Chromium 丑陋黑框，收起态悬停名片与展开按钮统一走 `Tooltip`；
 *   5. 滚动容器禁止声明 `scroll-behavior: smooth`（违反 Gate 4c 性能红线）。
 *
 * 【约束与规则 (Rules)】
 *   1. 头像容器恒为 `size-8 shrink-0 aspect-square rounded-full`，严禁外圈 `ring-*`；
 *   2. 选中态完全受控于 `activeBotId`，`tabIndex` 由 `resolveFocusableBotId` 计算；
 *   3. 展开/收起按钮恒固定在微轨底部，展开态显式带「收起」文案；
 *   4. 所有文案走 `t()`，颜色与圆角严格使用语义 Token，间距落在 4px 整数网格。
 */

const AVATAR_SIZE = '100%';

export interface BotHeroCarouselProps {
  /** 花名册（快照派生，只读）。 */
  roster: readonly BotRosterEntry[];
  /** 当前选中的 BOT（壳层状态机权威值）。 */
  activeBotId: string;
  /** 当前选中 BOT 的草稿：用于回显编辑中的名称、头像与模型。 */
  activeDraft?: BotDraftState;
  /** 保存中锁定选择栏，防止在提交途中切换 BOT。 */
  locked?: boolean;
  /** 选中目标 BOT 后通知壳层加载详情（壳层负责防抖与令牌收敛）。 */
  onSettle: (botId: string) => void;
  /** 保留可选签名以兼容既有调用方类型契约。 */
  onRequestAvatarUpload?: (botId: string) => void;
}

export function BotHeroCarousel({
  roster,
  activeBotId,
  activeDraft,
  locked = false,
  onSettle,
}: BotHeroCarouselProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(true);
  const [filterQuery, setFilterQuery] = React.useState('');
  const listRef = React.useRef<HTMLDivElement>(null);
  const tabRefs = React.useRef<Map<string, HTMLButtonElement>>(new Map());
  const [glider, setGlider] = React.useState<{ top: number; height: number } | null>(null);

  const visibleRoster = React.useMemo(
    () => (expanded ? filterBotRoster(roster, filterQuery) : [...roster]),
    [expanded, filterQuery, roster],
  );
  const focusableId = resolveFocusableBotId(visibleRoster, activeBotId);

  const measureGlider = React.useCallback((): void => {
    const activeNode = tabRefs.current.get(activeBotId);
    if (!activeNode || activeNode.offsetHeight <= 0) {
      setGlider(null);
      return;
    }
    const next = { top: activeNode.offsetTop, height: activeNode.offsetHeight };
    setGlider((prev) => (prev && prev.top === next.top && prev.height === next.height ? prev : next));
  }, [activeBotId]);

  React.useLayoutEffect(() => {
    measureGlider();
    const listNode = listRef.current;
    if (!listNode || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureGlider);
    observer.observe(listNode);
    for (const el of tabRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, visibleRoster.length, filterQuery, measureGlider]);

  React.useEffect(() => {
    const node = tabRefs.current.get(activeBotId);
    if (!node || typeof node.scrollIntoView !== 'function') return;
    node.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [activeBotId, visibleRoster.length]);

  const selectBot = (botId: string, focusTab = false): void => {
    if (locked || !botId || botId === activeBotId) return;
    onSettle(botId);
    if (focusTab) {
      window.requestAnimationFrame(() => {
        tabRefs.current.get(botId)?.focus();
      });
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (locked) return;
    const targetIndex = resolveCarouselKeyTarget(event.key, index, visibleRoster.length);
    if (targetIndex < 0) return;
    event.preventDefault();
    const target = visibleRoster[targetIndex];
    if (target) selectBot(target.id, true);
  };

  const toggleExpanded = (): void => {
    setExpanded((prev) => {
      if (prev) setFilterQuery('');
      return !prev;
    });
  };

  return (
    <aside
      data-bot-carousel="true"
      data-bot-rail-expanded={expanded ? 'true' : 'false'}
      className="relative flex h-full shrink-0 flex-col border-r border-border-subtle bg-panel ease-out"
      style={{
        width: expanded ? 204 : 64,
        transitionProperty: 'width',
        transitionDuration: '200ms',
        transitionTimingFunction: 'ease-out',
      }}
    >
      {expanded ? (
        <div className="flex shrink-0 flex-col gap-2 border-b border-border-subtle px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-caption font-semibold text-secondary-foreground">
              {t('bot.railTitle', { count: roster.length })}
            </span>
          </div>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              size="xs"
              value={filterQuery}
              data-bot-rail-filter="true"
              aria-label={t('bot.railFilterPlaceholder')}
              placeholder={t('bot.railFilterPlaceholder')}
              onChange={(event) => setFilterQuery(event.target.value)}
              className="pl-7"
            />
          </div>
        </div>
      ) : null}

      <div
        ref={listRef}
        role="tablist"
        aria-label={t('bot.selectBot')}
        aria-orientation="vertical"
        className="scrollbar-thin relative flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2"
      >
        {glider ? (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-2 top-0 rounded-card bg-card-active shadow-card transition-transform duration-200 ease-out"
              style={{
                height: glider.height,
                transform: `translate3d(0, ${glider.top}px, 0)`,
              }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-1 top-0 z-10 w-1 rounded-full bg-primary transition-transform duration-200 ease-out"
              style={{
                height: Math.max(12, glider.height - 16),
                transform: `translate3d(0, ${glider.top + 8}px, 0)`,
              }}
            />
          </>
        ) : null}

        {visibleRoster.length === 0 ? (
          <p className="px-2 py-4 text-center text-caption text-muted-foreground">{t('bot.railEmptyFilter')}</p>
        ) : (
          visibleRoster.map((bot, index) => {
            const isSelected = bot.id === activeBotId;
            const isFocusable = bot.id === focusableId;
            const draft = isSelected ? activeDraft : undefined;
            const title = resolveBotDisplayTitle(bot.displayName, bot.id, draft);
            const subtitle = resolveBotCardSubtitle(
              bot.model,
              bot.id,
              draft,
              (modelId) => presentModel(modelId).name,
            );
            const avatarSrc = resolveBotAvatar(bot.avatar, draft);
            const hasDraft = Boolean(bot.hasDraft);
            const cardTooltip = `${title} · ${subtitle}${bot.isDefault ? ` (${t('bot.defaultBadge')})` : ''}`;

            const buttonNode = (
              <button
                key={bot.id}
                ref={(node) => {
                  if (node) tabRefs.current.set(bot.id, node);
                  else tabRefs.current.delete(bot.id);
                }}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-label={title}
                tabIndex={isFocusable ? 0 : -1}
                disabled={locked}
                data-bot-slot={bot.id}
                data-bot-id={bot.id}
                onClick={() => selectBot(bot.id)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className={`relative z-10 flex w-full shrink-0 items-center rounded-card text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  expanded ? 'gap-2 px-2 py-2' : 'justify-center py-2'
                } ${
                  isSelected
                    ? glider
                      ? 'text-foreground'
                      : 'bg-card-active text-foreground'
                    : 'text-secondary-foreground hover:bg-card-hover hover:text-foreground'
                } ${locked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
              >
                <span
                  data-bot-avatar="true"
                  className="relative flex shrink-0 aspect-square items-center justify-center overflow-hidden rounded-full"
                  style={{ width: 36, height: 36 }}
                  dangerouslySetInnerHTML={{
                    __html: renderBotAvatar(bot.id, title, avatarSrc, AVATAR_SIZE, 'circle'),
                  }}
                />
                {!expanded && hasDraft ? (
                  <span
                    aria-label={t('bot.unsavedDot')}
                    className="pointer-events-none absolute right-1 top-1 size-2 rounded-full bg-warning"
                  />
                ) : null}
                {expanded ? (
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-center gap-1">
                      <span
                        className={`truncate text-aux ${
                          isSelected ? 'font-semibold text-foreground' : 'font-medium text-foreground'
                        }`}
                      >
                        {title}
                      </span>
                      {bot.isDefault ? (
                        <Badge variant="default" className="shrink-0 px-2 py-0 text-micro">
                          {t('bot.defaultBadge')}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="truncate font-code text-micro text-muted-foreground">{subtitle}</span>
                  </span>
                ) : null}
                {expanded && hasDraft ? (
                  <span
                    aria-label={t('bot.unsavedDot')}
                    className="size-2 shrink-0 rounded-full bg-warning"
                  />
                ) : null}
              </button>
            );

            return (
              <Tooltip key={bot.id} content={cardTooltip} placement="right" disabled={expanded}>
                {buttonNode}
              </Tooltip>
            );
          })
        )}
      </div>

      {/* 展开/收起按钮：固定在微轨最底部，使用标准分栏图标并禁用箭头 */}
      <div className="flex shrink-0 items-center justify-center border-t border-border-subtle p-2">
        {expanded ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-bot-rail-toggle="true"
            aria-expanded="true"
            onClick={toggleExpanded}
            className="w-full justify-start gap-2 text-secondary-foreground"
          >
            <PanelLeftClose aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{t('bot.railCollapse')}</span>
          </Button>
        ) : (
          <Tooltip content={t('bot.railExpand')} placement="right">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-bot-rail-toggle="true"
              aria-expanded="false"
              aria-label={t('bot.railExpand')}
              onClick={toggleExpanded}
              className="text-secondary-foreground"
            >
              <PanelLeftOpen aria-hidden="true" className="size-4 shrink-0" />
            </Button>
          </Tooltip>
        )}
      </div>
    </aside>
  );
}
