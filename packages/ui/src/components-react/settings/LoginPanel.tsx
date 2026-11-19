import * as React from 'react';
import { t } from '../../i18n/index.js';
import { Button } from '../primitives/Button.js';
import { InlineStrip } from './InlineStrip.js';

/**
 * 一次设备码登录的可见状态。
 * 【规则】只有 `approved` 是成功；`pending` 必须持续显示验证码与地址，让用户知道去哪完成。
 */
export interface LoginState {
  providerId: string;
  sessionId: string;
  userCode: string;
  verificationUrl: string;
  status: 'pending' | 'approved' | 'failed' | 'cancelled';
  message: string;
  pending: boolean;
}

/**
 * 设备码登录面板（从 ProvidersAdminPanel 拆出）。
 *
 * 【为什么单独成文件】提供商主面板已经超过单文件行数上限；登录态的三分支渲染
 *   与主列表没有共享状态，搬走后主面板只剩"表 + 行 + 动作"，可继续收敛。
 * 【约束与规则】本组件不取数、不轮询；所有状态与动作由调用方注入。
 */
export function LoginPanel({
  state,
  onCancel,
  onCopy,
}: {
  state: LoginState;
  onCancel: () => void;
  onCopy: (text: string) => void;
}): React.ReactElement {
  if (state.status === 'approved') {
    return (
      <p className="text-caption text-success" role="status">
        {t('settings.loginApproved')}
      </p>
    );
  }
  if (state.status === 'failed' || state.status === 'cancelled') {
    return (
      <p className="text-caption text-destructive" role="alert">
        {state.status === 'cancelled' ? t('settings.loginCancelled') : t('settings.loginFailed')}
        {state.message ? ` · ${state.message}` : ''}
      </p>
    );
  }
  return (
    <InlineStrip label={t('settings.loginCode')} busy={state.pending}>
      <p className="text-caption text-muted-foreground">{t('settings.loginCode')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-inner bg-input px-2 py-1 font-code text-body text-foreground">{state.userCode}</code>
        <Button variant="ghost" size="sm" type="button" onClick={() => onCopy(state.userCode)}>
          {t('settings.loginCopyCommand')}
        </Button>
      </div>
      {state.verificationUrl ? (
        <a
          className="truncate font-code text-caption text-secondary-foreground underline decoration-border-strong underline-offset-2"
          href={state.verificationUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          {state.verificationUrl}
        </a>
      ) : null}
      <div className="flex items-center gap-2">
        <span className="text-caption text-muted-foreground">{t('settings.loginPending')}</span>
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          {t('settings.cancel')}
        </Button>
      </div>
    </InlineStrip>
  );
}
