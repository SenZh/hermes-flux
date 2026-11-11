import * as React from 'react';
import { t } from '../../i18n/index.js';
import { Button } from '../primitives/Button.js';
import type { SettingsLoadable } from './settingsModel.js';

/**
 * 网关数据边界：加载中 / 失败 / 空 三种状态各自可见。
 *
 * 【防范的历史坑 (Pitfall)】
 *   旧设置页在网关未连接时渲染一屏硬编码卡片，用户无法分辨"没有数据"与"没连上网关"。
 *   协议成功但形状不符必须显式失败，禁止把畸形响应伪装成空列表（Failure Is Not Empty）。
 *
 * 【约束与规则 (Rules)】
 *   1. 只有 `error` 才渲染重试入口，`idle/loading` 只显示加载文案；
 *   2. 空态文案由调用方给定，组件不猜测业务语义。
 */
export function LoadBoundary<T>({
  state,
  onRetry,
  emptyLabel,
  children,
}: {
  state: SettingsLoadable<T>;
  onRetry: () => void;
  emptyLabel: string;
  children: (data: T) => React.ReactNode;
}): React.ReactElement {
  if (state.status === 'loading' || state.status === 'idle') {
    return <p className="py-6 text-body text-muted-foreground">{t('settings.loading')}</p>;
  }
  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-2 rounded-panel border border-border-subtle bg-panel px-4 py-3">
        <span className="text-body text-destructive">{t('settings.loadFailed')}</span>
        <span className="text-caption text-muted-foreground">{state.message}</span>
        <Button variant="outline" size="sm" type="button" onClick={onRetry}>
          {t('settings.retry')}
        </Button>
      </div>
    );
  }
  const isEmpty = Array.isArray(state.data) ? state.data.length === 0 : false;
  if (isEmpty) {
    return <p className="py-6 text-body text-muted-foreground">{emptyLabel}</p>;
  }
  return <>{children(state.data)}</>;
}
