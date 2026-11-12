import * as React from 'react';
import { t, type I18nKey } from '../../i18n/index.js';
import { cn } from '../../lib/utils.js';
import type { ActivityState, ActivityTransition } from '../../components/LeftRail/types.js';

export type ActivityIndicatorPlacement = 'inline' | 'corner';

export type ActivityEntityKind = 'session' | 'bot' | 'group';

export interface ActivityIndicatorProps {
  state?: ActivityState;
  transition?: ActivityTransition;
  transitionToken?: number;
  placement?: ActivityIndicatorPlacement;
  entityKind?: ActivityEntityKind;
  className?: string;
  title?: string;
}

type CloudCssVars = React.CSSProperties & Record<`--${string}`, string | number>;

interface CloudANodeSpec {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly dx: number;
  readonly dy: number;
  readonly delayMs: number;
  readonly on: boolean;
  readonly tx?: number;
  readonly ty?: number;
  readonly step?: number;
}

interface CloudANode extends CloudANodeSpec {
  readonly leftPct: string;
  readonly topPct: string;
  readonly targetLeftPct: string;
  readonly targetTopPct: string;
  readonly fromX: string;
  readonly fromY: string;
  readonly settleToX: string;
  readonly settleToY: string;
  readonly offsetPx: string;
}

const CLOUD_VIEW_W = 23;
const CLOUD_VIEW_H = 15;
const CLOUD_CANVAS_W = 19;
const CLOUD_CANVAS_H = 14;
const CLOUD_CENTER_X = CLOUD_VIEW_W / 2;
const CLOUD_CENTER_Y = CLOUD_VIEW_H / 2;

function toPctX(val: number): string {
  return `${((val / CLOUD_VIEW_W) * 100).toFixed(2)}%`;
}

function toPctY(val: number): string {
  return `${((val / CLOUD_VIEW_H) * 100).toFixed(2)}%`;
}

function buildCloudANodes(specs: readonly CloudANodeSpec[]): readonly CloudANode[] {
  return specs.map((node) => {
    const tx = node.tx ?? node.x;
    const ty = node.ty ?? node.y;
    const fromXVal = ((node.x - tx) / CLOUD_VIEW_W) * CLOUD_CANVAS_W;
    const fromYVal = ((node.y - ty) / CLOUD_VIEW_H) * CLOUD_CANVAS_H;
    const settleXVal = ((CLOUD_CENTER_X - node.x) / CLOUD_VIEW_W) * CLOUD_CANVAS_W * 0.65;
    const settleYVal = ((CLOUD_CENTER_Y - node.y) / CLOUD_VIEW_H) * CLOUD_CANVAS_H * 0.65;
    return {
      ...node,
      leftPct: toPctX(node.x),
      topPct: toPctY(node.y),
      targetLeftPct: toPctX(tx),
      targetTopPct: toPctY(ty),
      fromX: `${fromXVal.toFixed(2)}px`,
      fromY: `${fromYVal.toFixed(2)}px`,
      settleToX: `${settleXVal.toFixed(2)}px`,
      settleToY: `${settleYVal.toFixed(2)}px`,
      offsetPx: `${(-node.size / 2).toFixed(2)}px`,
    };
  });
}

const CLOUD_A_NODES: readonly CloudANode[] = buildCloudANodes([
  { x: 2.6, y: 11.8, size: 2.1, dx: -0.9, dy: 0.4, delayMs: 0, on: false },
  { x: 5.5, y: 12.0, size: 2.3, dx: -0.6, dy: 0.5, delayMs: 160, on: false },
  { x: 8.4, y: 12.1, size: 2.4, dx: -0.3, dy: 0.4, delayMs: 320, on: true, tx: 7.4, ty: 12.2, step: 2 },
  { x: 11.3, y: 12.1, size: 2.4, dx: 0.2, dy: 0.5, delayMs: 480, on: false },
  { x: 14.2, y: 12.0, size: 2.3, dx: 0.5, dy: 0.4, delayMs: 640, on: false },
  { x: 17.1, y: 11.9, size: 2.2, dx: 0.8, dy: 0.4, delayMs: 800, on: false },
  { x: 19.9, y: 11.6, size: 2.0, dx: 1.0, dy: 0.3, delayMs: 960, on: false },
  { x: 1.9, y: 9.5, size: 2.1, dx: -1.1, dy: 0.2, delayMs: 120, on: false },
  { x: 4.4, y: 9.2, size: 2.4, dx: -0.7, dy: -0.3, delayMs: 280, on: true, tx: 3.8, ty: 8.8, step: 0 },
  { x: 6.9, y: 9.4, size: 2.5, dx: -0.4, dy: 0.3, delayMs: 440, on: true, tx: 5.5, ty: 10.5, step: 1 },
  { x: 9.5, y: 9.1, size: 2.6, dx: 0.0, dy: -0.3, delayMs: 600, on: true, tx: 9.6, ty: 10.0, step: 3 },
  { x: 12.2, y: 9.2, size: 2.5, dx: 0.4, dy: 0.3, delayMs: 760, on: false },
  { x: 14.9, y: 9.1, size: 2.4, dx: 0.6, dy: -0.2, delayMs: 920, on: false },
  { x: 17.6, y: 9.2, size: 2.3, dx: 0.9, dy: 0.2, delayMs: 1080, on: false },
  { x: 20.6, y: 9.4, size: 2.0, dx: 1.1, dy: 0.3, delayMs: 1240, on: false },
  { x: 4.2, y: 6.5, size: 2.2, dx: -0.8, dy: -0.5, delayMs: 240, on: false },
  { x: 7.3, y: 6.1, size: 2.5, dx: -0.4, dy: -0.6, delayMs: 420, on: false },
  { x: 10.7, y: 6.0, size: 2.6, dx: 0.1, dy: -0.6, delayMs: 620, on: true, tx: 11.8, ty: 7.7, step: 4 },
  { x: 14.0, y: 6.0, size: 2.4, dx: 0.5, dy: -0.5, delayMs: 820, on: true, tx: 14.1, ty: 5.4, step: 5 },
  { x: 17.4, y: 6.4, size: 2.2, dx: 0.8, dy: -0.4, delayMs: 1020, on: false },
  { x: 6.3, y: 3.6, size: 2.2, dx: -0.5, dy: -0.7, delayMs: 360, on: false },
  { x: 9.0, y: 2.8, size: 2.4, dx: 0.0, dy: -0.8, delayMs: 560, on: false },
  { x: 11.9, y: 3.3, size: 2.3, dx: 0.4, dy: -0.7, delayMs: 740, on: false },
  { x: 15.5, y: 3.9, size: 2.2, dx: 0.7, dy: -0.6, delayMs: 940, on: true, tx: 16.6, ty: 3.1, step: 6 },
]);

const CLOUD_CORE_NODES = CLOUD_A_NODES.filter((node) => node.on);

const RUNNING_STATUS_KEY_BY_KIND: Readonly<Record<ActivityEntityKind, I18nKey>> = {
  session: 'rail.activityStatusRunning',
  bot: 'rail.activityStatusThinking',
  group: 'rail.activityStatusCollaborating',
};

const CORNER_DOT_BASE_CLASS = 'absolute right-0 top-0 inline-flex size-2 items-center justify-center rounded-full ring-2 ring-sidebar';

/**
 * 统一三态活动指示器原语 (ActivityIndicator)。
 *
 * 设计意图 (Why)：
 *   微轨头像角标（corner）保持简洁亮蓝圆点，抽屉列表行（inline）在时间前方呈现
 *   纯 HTML/CSS 驱动的 24 颗积雨流云点阵与流光状态词，兼顾辨识度与零 SVG 约束。
 *
 * 防范的历史坑 (Pitfall)：
 *   1. 抽屉重挂载时静态 unread 不可播放跃迁动画，必须由 `transition === 'just-completed'` 门控；
 *   2. 普通会话行强制零 `<svg>`，点阵粒子必须使用纯 `<i>` + GPU `transform/opacity` 实现；
 *   3. 聚焦实体收敛到 `read` 时，仅 `just-completed` 窗口渲染独立 `.activity-settle-fade` 节点。
 *
 * 约束与规则 (Rules)：
 *   - 静态/普通 `read` 态与 `undefined` 严格返回 `null`；
 *   - 禁止出现硬编码色值、原生调色板类名或硬编码中文文案。
 */
export function ActivityIndicator({
  state,
  transition = 'none',
  transitionToken,
  placement = 'inline',
  entityKind = 'session',
  className,
  title,
}: ActivityIndicatorProps): React.ReactElement | null {
  if (!state || state === 'read') {
    if (state === 'read' && transition === 'just-completed') {
      if (placement === 'corner') {
        return (
          <span
            key={`settle-${transitionToken ?? 0}`}
            aria-hidden="true"
            className={cn(
              'activity-settle-fade flux-activity-dot flux-activity-dot--settle',
              CORNER_DOT_BASE_CLASS,
              className,
            )}
            data-status="read"
            data-transition="just-completed"
            data-placement="corner"
          />
        );
      }

      return (
        <span
          key={`settle-${transitionToken ?? 0}`}
          aria-hidden="true"
          className={cn('activity-settle-fade flux-cloud-settle', className)}
          data-status="read"
          data-transition="just-completed"
          data-placement="inline"
        >
          <span className="flux-cloud-canvas">
            {CLOUD_CORE_NODES.map((node, index) => {
              const dotStyle: CloudCssVars = {
                left: node.leftPct,
                top: node.topPct,
                width: `${node.size}px`,
                height: `${node.size}px`,
                marginLeft: node.offsetPx,
                marginTop: node.offsetPx,
                '--to-x': node.settleToX,
                '--to-y': node.settleToY,
              };
              return <i key={index} className="flux-cloud-settle-dot" style={dotStyle} />;
            })}
          </span>
        </span>
      );
    }
    return null;
  }

  const isRunning = state === 'running';
  const resolvedLabel = title ?? t(isRunning ? 'rail.activityRunning' : 'rail.activityUnread');
  const effectiveTransition: ActivityTransition = transition ?? 'none';

  if (placement === 'corner') {
    if (isRunning) {
      return (
        <span
          className={cn(
            'activity-pulse-indicator flux-activity-dot flux-activity-dot--running',
            CORNER_DOT_BASE_CLASS,
            className,
          )}
          data-status="running"
          data-placement="corner"
          title={resolvedLabel}
          aria-label={resolvedLabel}
          role="status"
          aria-live="off"
        />
      );
    }

    return (
      <span
        key={effectiveTransition === 'just-completed' ? `unread-${transitionToken ?? 0}` : 'unread-static'}
        className={cn(
          'activity-unread-badge flux-activity-dot flux-activity-dot--unread',
          CORNER_DOT_BASE_CLASS,
          className,
        )}
        data-status="unread"
        data-transition={effectiveTransition}
        data-placement="corner"
        title={resolvedLabel}
        aria-label={resolvedLabel}
        role="status"
        aria-live="off"
      />
    );
  }

  if (isRunning) {
    const statusWord = t(RUNNING_STATUS_KEY_BY_KIND[entityKind]);
    return (
      <span
        className={cn(
          'activity-pulse-indicator flux-cloud-indicator flux-cloud-indicator--running inline-flex items-center gap-1 shrink-0 pointer-events-none',
          className,
        )}
        data-status="running"
        data-placement="inline"
        title={resolvedLabel}
        aria-label={resolvedLabel}
        role="status"
        aria-live="off"
      >
        <span aria-hidden="true" className="flux-cloud-canvas">
          <span className="flux-cloud-fog" />
          {CLOUD_A_NODES.map((node, index) => {
            const dotStyle: CloudCssVars = {
              left: node.leftPct,
              top: node.topPct,
              width: `${node.size}px`,
              height: `${node.size}px`,
              marginLeft: node.offsetPx,
              marginTop: node.offsetPx,
              '--dx': `${node.dx}px`,
              '--dy': `${node.dy}px`,
              '--d': `${node.delayMs}ms`,
            };
            return <i key={index} className="flux-cloud-dot" style={dotStyle} />;
          })}
        </span>
        <span className="flux-cloud-label flux-cloud-label--running">{statusWord}</span>
      </span>
    );
  }

  const unreadKey = effectiveTransition === 'just-completed'
    ? `unread-${transitionToken ?? 0}`
    : 'unread-static';

  return (
    <span
      key={unreadKey}
      className={cn(
        'activity-unread-badge flux-cloud-indicator flux-cloud-indicator--unread inline-flex items-center gap-1 shrink-0 pointer-events-none',
        className,
      )}
      data-status="unread"
      data-transition={effectiveTransition}
      data-placement="inline"
      title={resolvedLabel}
      aria-label={resolvedLabel}
      role="status"
      aria-live="off"
    >
      <span aria-hidden="true" className="flux-cloud-canvas">
        {effectiveTransition === 'just-completed' && <span className="flux-cloud-ripple" />}
        {CLOUD_A_NODES.map((node, index) => {
          const dotStyle: CloudCssVars = {
            left: node.on ? node.targetLeftPct : node.leftPct,
            top: node.on ? node.targetTopPct : node.topPct,
            width: `${node.size}px`,
            height: `${node.size}px`,
            marginLeft: node.offsetPx,
            marginTop: node.offsetPx,
            '--from-x': node.on ? node.fromX : '0px',
            '--from-y': node.on ? node.fromY : '0px',
            '--step': node.step ?? 0,
          };
          return (
            <i
              key={index}
              className="flux-cloud-dot"
              data-on={node.on ? '1' : '0'}
              style={dotStyle}
            />
          );
        })}
      </span>
      <span className="flux-cloud-label flux-cloud-label--done">{t('rail.activityStatusDone')}</span>
    </span>
  );
}
