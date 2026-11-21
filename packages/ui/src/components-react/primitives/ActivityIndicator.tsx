import * as React from 'react';
import { t, type I18nKey } from '../../i18n/index.js';
import { cn } from '../../lib/utils.js';
import type { ActivityState, ActivityTransition } from '../../components/LeftRail/types.js';
import { getPointCloudSpec, type ActivityIndicatorVariant } from '../../tokens/activityIndicator.js';

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
 *   微轨头像角标（corner）保持高对比圆点（深色亮白 / 浅色蓝），抽屉列表行（inline）
 *   采用纯 HTML/CSS 几何雕塑（流云丝带 / 陀螺 / 轨道 / 突触 / 弹簧 / 旋涡）及 12 套 3D 透视点云装置
 *   （6 套 30×16 宽幅 + 6 套 18×18 紧凑，预烘焙关键帧驱动），同时匹配轻盈 11px 状态词。
 *
 * 防范的历史坑 (Pitfall)：
 *   1. 旧版平面密点粘连成块；现流云/突触/旋涡保持大留白雕塑，新增点云全部带 3D 纵深尺度与透明度衰减；
 *   2. 抽屉重挂载时静态 unread 不可播放跃迁动画，必须由 `transition === 'just-completed'` 门控；
 *   3. 普通会话行强制零 `<svg>`，所有图形与粒子均由语义 `<span>` / `<i>` + GPU `transform/opacity` 实现；
 *   4. 聚焦实体收敛到 `read` 时，仅 `just-completed` 窗口渲染独立 `.activity-settle-fade` 节点。
 *
 * 约束与规则 (Rules)：
 *   - 静态/普通 `read` 态与 `undefined` 严格返回 `null`；
 *   - 禁止出现硬编码色值、原生调色板类名或硬编码中文文案；
 *   - 外层画布类名（.flux-cloud-canvas / .flux-pc-canvas / .flux-motif-*）与 tailwind-entry.css 预览 zoom 契约同源。
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
          <span className="flux-cloud-canvas flux-cloud-canvas--settle">
            <span className="flux-cloud-settle-stream flux-cloud-settle-stream--top" />
            <span className="flux-cloud-settle-stream flux-cloud-settle-stream--mid" />
            <span className="flux-cloud-settle-stream flux-cloud-settle-stream--low" />
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
    const pcSpec = getPointCloudSpec(variant);
    if (pcSpec) {
      if (running) {
        return (
          <span
            className={cn(
              `flux-motif-${variant}`,
              'flux-pc-canvas',
              pcSpec.shape === 'wide' ? 'flux-pc-canvas--wide' : 'flux-pc-canvas--sq',
            )}
            aria-hidden="true"
          >
            {Array.from({ length: pcSpec.dotCount }, (_, idx) => (
              <i key={idx} className={`flux-pc-dot flux-pc-${pcSpec.code}-${idx}`} />
            ))}
          </span>
        );
      }
      return (
        <span className={`flux-motif-${variant} flux-motif-${variant}--done flux-pc-done`} aria-hidden="true">
          {effectiveTransition === 'just-completed' && <span className="flux-cloud-ripple" />}
          <span className="flux-pc-done-ring">
            <i className="flux-pc-done-tick" />
          </span>
          <i className="flux-pc-done-spark flux-pc-done-spark--a" />
          <i className="flux-pc-done-spark flux-pc-done-spark--b" />
          <i className="flux-pc-done-spark flux-pc-done-spark--c" />
        </span>
      );
    }

    if (variant === 'gyro') {
      if (running) {
        return (
          <span className="flux-motif-gyro" aria-hidden="true">
            <span className="flux-gyro-gimbal">
              <span className="flux-gyro-ring flux-gyro-ring--a" />
              <span className="flux-gyro-ring flux-gyro-ring--b" />
              <span className="flux-gyro-ring flux-gyro-ring--c" />
            </span>
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
            <span className="flux-orbit-plane flux-orbit-plane--a">
              <span className="flux-orbit-ring flux-orbit-ring--a" />
              <span className="flux-orbit-arm flux-orbit-arm--a"><i className="flux-orbit-sat-a" /></span>
            </span>
            <span className="flux-orbit-plane flux-orbit-plane--b">
              <span className="flux-orbit-ring flux-orbit-ring--b" />
              <span className="flux-orbit-arm flux-orbit-arm--b"><i className="flux-orbit-sat-b" /></span>
            </span>
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
      if (running) {
        return (
          <span className="flux-motif-synapse" aria-hidden="true">
            <span className="flux-synapse-field">
              <span className="flux-synapse-halo" />
              <span className="flux-synapse-branch flux-synapse-branch--a">
                <i className="flux-synapse-axon" />
                <i className="flux-synapse-pulse" />
                <i className="flux-synapse-node" />
              </span>
              <span className="flux-synapse-branch flux-synapse-branch--b">
                <i className="flux-synapse-axon" />
                <i className="flux-synapse-pulse" />
                <i className="flux-synapse-node" />
              </span>
              <span className="flux-synapse-branch flux-synapse-branch--c">
                <i className="flux-synapse-axon" />
                <i className="flux-synapse-pulse" />
                <i className="flux-synapse-node" />
              </span>
            </span>
            <span className="flux-synapse-wave" />
            <i className="flux-synapse-core" />
          </span>
        );
      }
      return (
        <span className="flux-motif-synapse flux-motif-synapse--done" aria-hidden="true">
          <span className="flux-synapse-done-ring">
            <i className="flux-synapse-tick" />
          </span>
          <i className="flux-synapse-done-node flux-synapse-done-node--a" />
          <i className="flux-synapse-done-node flux-synapse-done-node--b" />
          <i className="flux-synapse-done-node flux-synapse-done-node--c" />
        </span>
      );
    }

    if (variant === 'spring') {
      if (running) {
        return (
          <span className="flux-motif-spring" aria-hidden="true">
            <span className="flux-spring-arc flux-spring-arc--outer" />
            <span className="flux-spring-arc flux-spring-arc--mid" />
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
            <span className="flux-vortex-field">
              <span className="flux-vortex-arm flux-vortex-arm--outer" />
              <span className="flux-vortex-arm flux-vortex-arm--mid" />
              <span className="flux-vortex-arm flux-vortex-arm--inner" />
            </span>
            <i className="flux-vortex-eye" />
          </span>
        );
      }
      return (
        <span className="flux-motif-matrix flux-motif-matrix--done" aria-hidden="true">
          <span className="flux-vortex-done-outer">
            <span className="flux-vortex-done-ring"><i className="flux-vortex-tick" /></span>
          </span>
        </span>
      );
    }

    // Default 'cloud' (层叠渐变流云丝带 + 微星流光)
    if (running) {
      return (
        <span aria-hidden="true" className="flux-cloud-canvas">
          <span className="flux-cloud-stream flux-cloud-stream--top" />
          <span className="flux-cloud-stream flux-cloud-stream--mid" />
          <span className="flux-cloud-stream flux-cloud-stream--low" />
          <i className="flux-cloud-glint" />
        </span>
      );
    }

    return (
      <span aria-hidden="true" className="flux-cloud-canvas flux-cloud-canvas--done">
        {effectiveTransition === 'just-completed' && <span className="flux-cloud-ripple" />}
        <span className="flux-cloud-done-ring">
          <i className="flux-cloud-check" />
        </span>
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
