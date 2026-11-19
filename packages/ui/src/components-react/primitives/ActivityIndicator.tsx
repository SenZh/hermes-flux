import * as React from 'react';
import { t, type I18nKey } from '../../i18n/index.js';
import { cn } from '../../lib/utils.js';
import type { ActivityState, ActivityTransition } from '../../components/LeftRail/types.js';
import type { ActivityIndicatorVariant } from '../../tokens/activityIndicator.js';

export type ActivityIndicatorPlacement = 'inline' | 'corner';

export type ActivityEntityKind = 'session' | 'bot' | 'group';

export interface ActivityIndicatorProps {
  state?: ActivityState;
  transition?: ActivityTransition;
  transitionToken?: number;
  placement?: ActivityIndicatorPlacement;
  entityKind?: ActivityEntityKind;
  variant?: ActivityIndicatorVariant;
  className?: string;
  title?: string;
}

type CustomCssVars = React.CSSProperties & Record<`--${string}`, string | number>;

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
      // 命中偏移取直径之半：除以 2 不产生新舍入，圆点恒以 (left,top) 为圆心，避免逐颗偏心。
      offsetPx: `${-(node.size / 2)}px`,
    };
  });
}

/**
 * 积雨流云点阵（稀疏版）。
 *
 * 【设计意图 Why】原 24 颗点阵铺在 19×14px 画布上，会话行内显示时点与点首尾相抵，
 *   视觉密度过高（密集恐惧观感），且雾底衬把细点糊成一团。改为 13 颗：层间竖直 2.8~3.0px、
 *   同层相邻 3.5~4.0px（view 坐标 4.2~4.8），颗粒之间留出明显空隙，才读得出"云 + 落雨"的形状。
 *
 * 【防范的历史坑 Pitfall】`on` 的 7 颗是"未读态收拢成对勾"的载体，不是构图上的勾选点：
 *   完成时它们会带着 `--from-x/--from-y` 位移飞到 `tx/ty`（对勾轨迹 0~6 号锚点）。
 *   因此 `on` 必须保持 7 颗，且每个载体到其锚点的位移都必须 ≥0.3px 且 ≤3.3px（实测 0.51~2.85px）——
 *   超过画布宽度的 ~15% 会变成横穿画面的长距离飞行，而位移归零则聚拢动画退化为瞬移。
 *
 * 【约束 Rules】
 *   1. `size` 即最终渲染直径（px），画布为 19×14，禁止把颗粒改回 2.4px 以上或增加颗数；
 *   2. 圆心由 left/top 百分比定位，`offsetPx` 恒等于 -size/2，改尺寸必须同步；
 *   3. 未读数必须恒为 7（对勾 7 锚点），改数量会破坏已完成态的图形语义；
 *   4. 【密度红线】相邻两层必须水平错位 ≥1.8（view 坐标），竖直堆叠会形成 2.8px 的
 *      贴点竖链——减颗数解决不了它，会话行里仍是"密密一列"，几何守卫有最小间距断言；
 *   5. 【飞行红线】改勾锚点或载体位置后必须复算位移，几何守卫逐点断言位移落在 [0.3, 3.3]px。
 */
const CLOUD_A_NODES: readonly CloudANode[] = buildCloudANodes([
  // 落雨层（最低，四点错开云腹层）
  { x: 4.2, y: 12.4, size: 2.0, dx: -0.7, dy: 0.4, delayMs: 0, on: false },
  { x: 8.6, y: 12.4, size: 2.2, dx: -0.4, dy: 0.5, delayMs: 180, on: true, tx: 7.4, ty: 12.2, step: 2 },
  { x: 13.0, y: 12.4, size: 2.2, dx: 0.2, dy: 0.5, delayMs: 360, on: false },
  { x: 17.4, y: 12.4, size: 2.0, dx: 0.7, dy: 0.4, delayMs: 540, on: false },
  // 云腹层
  { x: 2.2, y: 9.2, size: 2.0, dx: -0.9, dy: 0.2, delayMs: 90, on: true, tx: 3.8, ty: 8.8, step: 0 },
  { x: 6.4, y: 9.2, size: 2.1, dx: -0.5, dy: 0.3, delayMs: 270, on: true, tx: 5.5, ty: 10.5, step: 1 },
  { x: 10.8, y: 9.2, size: 2.3, dx: 0.1, dy: 0.3, delayMs: 450, on: true, tx: 9.6, ty: 10.0, step: 3 },
  { x: 15.6, y: 9.2, size: 2.0, dx: 0.8, dy: 0.2, delayMs: 630, on: false },
  // 云肩层
  { x: 4.4, y: 6.2, size: 2.1, dx: -0.7, dy: -0.4, delayMs: 180, on: false },
  { x: 8.8, y: 6.2, size: 2.3, dx: 0.0, dy: -0.5, delayMs: 360, on: true, tx: 11.8, ty: 7.7, step: 4 },
  { x: 13.6, y: 6.2, size: 2.1, dx: 0.6, dy: -0.4, delayMs: 540, on: true, tx: 14.1, ty: 5.4, step: 5 },
  // 云顶层（左肩一点 + 右端一点，右端同时是勾末载体，位移仅 0.50px）
  { x: 6.6, y: 3.2, size: 2.0, dx: -0.4, dy: -0.6, delayMs: 360, on: false },
  { x: 16.0, y: 3.2, size: 2.0, dx: 0.4, dy: -0.6, delayMs: 540, on: true, tx: 16.6, ty: 3.1, step: 6 },
]);

const CLOUD_CORE_NODES = CLOUD_A_NODES.filter((node) => node.on);

/** 4×4 神经突触点阵 (方案 6) */
const SYNAPSE_CELLS = Array.from({ length: 16 }, (_, index) => {
  const r = Math.floor(index / 4);
  const c = index % 4;
  const isCheck = (r === 3 && c === 1) || (r === 3 && c === 0) || (r === 2 && c === 1) || (r === 1 && c === 2) || (r === 0 && c === 3);
  const step = (r === 3 && c === 1) ? 0 : (r === 3 && c === 0) ? 1 : (r === 2 && c === 1) ? 2 : (r === 1 && c === 2) ? 3 : (r === 0 && c === 3) ? 4 : undefined;
  return { r, c, on: isCheck, step, delayMs: (r + c) * 90 };
});

/** 3D 旋涡流形点阵 (方案 M) 16 颗粒子 */
const MATRIX_NODES = Array.from({ length: 16 }, (_, i) => {
  const baseR = 1.8 + Math.sqrt(i) * 1.45;
  const theta = i * 2.39996;
  const x = 9.5 + Math.cos(theta) * baseR;
  const y = 7.5 + Math.sin(theta) * (baseR * 0.72);
  const checkX = [3.0, 4.8, 6.8, 9.0, 11.2, 13.4, 15.6][i] ?? x;
  const checkY = [8.8, 10.6, 12.4, 10.0, 7.6, 5.2, 2.8][i] ?? y;
  const on = i < 7;
  return {
    x,
    y,
    on,
    step: on ? i : undefined,
    fromX: `${(x - checkX).toFixed(2)}px`,
    fromY: `${(y - checkY).toFixed(2)}px`,
    targetLeftPct: `${((checkX / 19) * 100).toFixed(2)}%`,
    targetTopPct: `${((checkY / 15) * 100).toFixed(2)}%`,
    leftPct: `${((x / 19) * 100).toFixed(2)}%`,
    topPct: `${((y / 15) * 100).toFixed(2)}%`,
    delayMs: i * 80,
  };
});

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
 *   微轨头像角标（corner）保持简洁的高对比圆点（深色亮白 / 浅色蓝），抽屉列表行（inline）
 *   在时间前方呈现纯 HTML/CSS 驱动的 13 颗稀疏积雨流云点阵与流光状态词，兼顾辨识度与零 SVG 约束。
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
  variant = 'cloud',
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
            data-variant={variant}
          />
        );
      }

      return (
        <span
          key={`settle-${transitionToken ?? 0}`}
          aria-hidden="true"
          className={cn('activity-settle-fade flux-cloud-settle', `flux-variant-${variant}`, className)}
          data-status="read"
          data-transition="just-completed"
          data-placement="inline"
          data-variant={variant}
        >
          <span className="flux-cloud-canvas">
            {CLOUD_CORE_NODES.map((node, index) => {
              const dotStyle: CustomCssVars = {
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
          data-variant={variant}
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
        data-variant={variant}
        title={resolvedLabel}
        aria-label={resolvedLabel}
        role="status"
        aria-live="off"
      />
    );
  }

  const renderMotifContent = (running: boolean) => {
    if (variant === 'gyro') {
      if (running) {
        return (
          <span className="flux-motif-gyro" aria-hidden="true">
            <span className="flux-gyro-ring flux-gyro-ring--a"><i /><i /></span>
            <span className="flux-gyro-ring flux-gyro-ring--b"><i /><i /></span>
            <i className="flux-gyro-core" />
          </span>
        );
      }
      return (
        <span className="flux-motif-gyro flux-motif-gyro--done" aria-hidden="true">
          <span className="flux-gyro-done-ring"><i className="flux-gyro-tick" /></span>
        </span>
      );
    }

    if (variant === 'orbit') {
      if (running) {
        return (
          <span className="flux-motif-orbit" aria-hidden="true">
            <span className="flux-orbit-track" />
            <span className="flux-orbit-arm flux-orbit-arm--a"><i className="flux-orbit-sat-a" /></span>
            <span className="flux-orbit-arm flux-orbit-arm--b"><i className="flux-orbit-sat-b" /></span>
            <i className="flux-orbit-sun" />
          </span>
        );
      }
      return (
        <span className="flux-motif-orbit flux-motif-orbit--done" aria-hidden="true">
          <span className="flux-orbit-star" />
        </span>
      );
    }

    if (variant === 'synapse') {
      return (
        <span className={cn('flux-motif-synapse', !running && 'flux-motif-synapse--done')} aria-hidden="true">
          {SYNAPSE_CELLS.map((c, i) => (
            <i
              key={i}
              className="flux-synapse-cell"
              data-on={!running && c.on ? '1' : '0'}
              style={{
                '--d': `${c.delayMs}ms`,
                '--step': c.step ?? 0,
              } as CustomCssVars}
            />
          ))}
        </span>
      );
    }

    if (variant === 'spring') {
      if (running) {
        return (
          <span className="flux-motif-spring" aria-hidden="true">
            <span className="flux-spring-arc flux-spring-arc--outer" />
            <span className="flux-spring-arc flux-spring-arc--inner" />
            <i className="flux-spring-dot" />
          </span>
        );
      }
      return (
        <span className="flux-motif-spring flux-motif-spring--done" aria-hidden="true">
          <span className="flux-spring-done-ring"><i className="flux-spring-tick" /></span>
        </span>
      );
    }

    if (variant === 'matrix') {
      if (running) {
        return (
          <span className="flux-motif-matrix" aria-hidden="true">
            {MATRIX_NODES.map((m, i) => (
              <i
                key={i}
                className="flux-matrix-dot"
                style={{
                  left: m.leftPct,
                  top: m.topPct,
                  '--d': `${m.delayMs}ms`,
                } as CustomCssVars}
              />
            ))}
          </span>
        );
      }
      return (
        <span className="flux-motif-matrix flux-motif-matrix--done" aria-hidden="true">
          {MATRIX_NODES.map((m, i) => (
            <i
              key={i}
              className="flux-matrix-dot"
              data-on={m.on ? '1' : '0'}
              style={{
                left: m.on ? m.targetLeftPct : m.leftPct,
                top: m.on ? m.targetTopPct : m.topPct,
                '--from-x': m.on ? m.fromX : '0px',
                '--from-y': m.on ? m.fromY : '0px',
                '--step': m.step ?? 0,
              } as CustomCssVars}
            />
          ))}
        </span>
      );
    }

    // Default 'cloud' (方案 A · 积雨流云点阵)
    if (running) {
      return (
        <span aria-hidden="true" className="flux-cloud-canvas">
          <span className="flux-cloud-fog" />
          {CLOUD_A_NODES.map((node, index) => {
            const dotStyle: CustomCssVars = {
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
      );
    }

    return (
      <span aria-hidden="true" className="flux-cloud-canvas">
        {effectiveTransition === 'just-completed' && <span className="flux-cloud-ripple" />}
        {CLOUD_A_NODES.map((node, index) => {
          const dotStyle: CustomCssVars = {
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
    );
  };

  if (isRunning) {
    const statusWord = t(RUNNING_STATUS_KEY_BY_KIND[entityKind]);
    return (
      <span
        className={cn(
          'activity-pulse-indicator flux-cloud-indicator flux-cloud-indicator--running inline-flex items-center gap-1 shrink-0 pointer-events-none',
          `flux-variant-${variant}`,
          className,
        )}
        data-status="running"
        data-placement="inline"
        data-variant={variant}
        title={resolvedLabel}
        aria-label={resolvedLabel}
        role="status"
        aria-live="off"
      >
        {renderMotifContent(true)}
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
        `flux-variant-${variant}`,
        className,
      )}
      data-status="unread"
      data-transition={effectiveTransition}
      data-placement="inline"
      data-variant={variant}
      title={resolvedLabel}
      aria-label={resolvedLabel}
      role="status"
      aria-live="off"
    >
      {renderMotifContent(false)}
      <span className="flux-cloud-label flux-cloud-label--done">{t('rail.activityStatusDone')}</span>
    </span>
  );
}
