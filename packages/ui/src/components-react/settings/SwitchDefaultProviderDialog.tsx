import * as React from 'react';
import { AlertCircle, Search, X } from 'lucide-react';
import { collectReplacementModels, type ProviderView } from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import { presentModel } from '../../lib/modelPresentation.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { ModelOptionRow } from './ModelPicker.js';
import type { SettingsActionResult } from './settingsModel.js';

/**
 * 切换默认提供方并关闭原提供商的就地引导弹窗。
 *
 * 【设计意图 (Why)】
 *   当用户点击某 BOT 上带「默认」角标的头像企图关闭时，如果直接硬拦截让人手动跳去 BOT 配置页，
 *   路径冗长且容易迷路。本弹窗把“说明原因 + 从该 BOT 其他已开启提供商选一个替补默认模型 +
 *   确认后串行切换并关闭”全部收敛到当前页面一步完成。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 若不校验开关门期间的目标变化（例如换点另一家提供商或另一个 BOT），旧的选中项或报错会串台；
 *      每次开窗或目标变更时重新挑选首项替补并清空检索与告警态；
 *   2. 网关对高价模型回传 `confirmRequired` 时绝不能直接关闭窗口，必须就地展示确认说明并切换按钮文案。
 *
 * 【约束与规则 (Rules)】
 *   1. 候选集严格由 `@hermes-flux/core` 的 `collectReplacementModels` 算出，绝不在视图层拼过滤规则；
 *   2. `portal={false}` 不可省略（遵循设置弹窗家族的样式隔离与 Radix Esc 栈）。
 */
export function SwitchDefaultProviderDialog({
  open,
  onClose,
  botProfile,
  botDisplayName,
  currentModel,
  providerView,
  allViews,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  botProfile: string;
  botDisplayName: string;
  currentModel?: string;
  providerView: ProviderView | null;
  allViews: readonly ProviderView[];
  busy?: boolean;
  onConfirm: (selection: {
    newProviderId: string;
    newModel: string;
    confirmExpensive: boolean;
  }) => Promise<SettingsActionResult & { confirmRequired?: boolean; step?: 'switch' | 'disable' }>;
}): React.ReactElement | null {
  const groups = React.useMemo(
    () => (providerView ? collectReplacementModels(allViews, providerView.id, botProfile) : []),
    [allViews, providerView, botProfile],
  );

  const firstSelection = React.useMemo(
    () => (groups[0]?.models[0] ? { providerId: groups[0].providerId, model: groups[0].models[0] } : null),
    [groups],
  );

  const [selected, setSelected] = React.useState<{ providerId: string; model: string } | null>(firstSelection);
  const [query, setQuery] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [warning, setWarning] = React.useState('');
  const [error, setError] = React.useState('');

  const targetKey = open && providerView ? `${providerView.key}:${botProfile}` : 'closed';
  const prevTargetRef = React.useRef(targetKey);
  React.useEffect(() => {
    if (prevTargetRef.current === targetKey) return;
    prevTargetRef.current = targetKey;
    setSelected(firstSelection);
    setQuery('');
    setPending(false);
    setWarning('');
    setError('');
  }, [targetKey, firstSelection]);

  if (!open || !providerView) return null;

  const totalCandidates = groups.reduce((sum, group) => sum + group.models.length, 0);
  const needle = query.trim().toLowerCase();
  const visibleGroups = needle
    ? groups
        .map((group) => {
          if (group.providerName.toLowerCase().includes(needle)) return group;
          const filtered = group.models.filter((model) => {
            const displayName = presentModel(model, group.providerName).name.toLowerCase();
            return displayName.includes(needle) || model.toLowerCase().includes(needle);
          });
          return { ...group, models: filtered };
        })
        .filter((group) => group.models.length > 0)
    : groups;

  const resolvedModelName = currentModel ? presentModel(currentModel, providerView.name).name : '';
  const bodyMessage = resolvedModelName
    ? t('settings.providerSwitchBody', {
        bot: botDisplayName,
        provider: providerView.name,
        model: resolvedModelName,
      })
    : t('settings.providerSwitchBodyNoModel', {
        bot: botDisplayName,
        provider: providerView.name,
      });

  const confirm = async (confirmExpensive: boolean): Promise<void> => {
    if (!selected || pending || busy) return;
    setPending(true);
    setError('');
    if (!confirmExpensive) setWarning('');
    try {
      const outcome = await onConfirm({
        newProviderId: selected.providerId,
        newModel: selected.model,
        confirmExpensive,
      });
      setPending(false);
      if (outcome.ok) {
        setWarning('');
        onClose();
        return;
      }
      if (outcome.confirmRequired) {
        setWarning(outcome.message || t('settings.providerExpensiveWarning'));
        return;
      }
      // 第一步报错或第二步 DELETE 失败时必须清掉高价警告，否则确认按钮仍显示「仍然切换并关闭」。
      setWarning('');
      setError(outcome.message || t('settings.providerToggleFailed'));
    } catch (err: unknown) {
      setPending(false);
      setWarning('');
      setError(err instanceof Error ? err.message : t('settings.providerToggleFailed'));
    }
  };

  const confirmLabel = pending
    ? t('settings.providerSwitchSubmitting')
    : warning
      ? t('settings.providerSwitchConfirmExpensive')
      : t('settings.providerSwitchConfirm');

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent
        portal={false}
        className="flex max-h-modal-lg w-full max-w-lg flex-col gap-0 overflow-hidden rounded-window p-0"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <DialogTitle className="truncate text-section font-medium text-foreground">
            {t('settings.providerSwitchTitle')}
          </DialogTitle>
          <DialogDescription className="sr-only">{bodyMessage}</DialogDescription>
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            className="shrink-0"
            disabled={pending}
            aria-label={t('settings.close')}
            onClick={onClose}
          >
            <X size={14} aria-hidden="true" />
          </Button>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-hidden px-5 py-4">
          <div className="flex items-start gap-2 rounded-card border border-warning/40 bg-card px-3 py-3 text-aux text-foreground">
            <AlertCircle size={16} aria-hidden="true" className="mt-1 shrink-0 text-warning" />
            <p className="leading-relaxed">{bodyMessage}</p>
          </div>

          {groups.length > 0 && totalCandidates > 6 ? (
            <div className="relative flex shrink-0 items-center">
              <Search
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 text-muted-foreground"
              />
              <Input
                size="sm"
                value={query}
                disabled={pending}
                placeholder={t('settings.providerModelSearchPlaceholder')}
                aria-label={t('settings.providerModelSearchPlaceholder')}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-8"
              />
            </div>
          ) : null}

          <div
            role="radiogroup"
            aria-label={t('settings.providerModelPick')}
            className="max-h-picker-list flex-1 overflow-y-auto rounded-card border border-border-subtle bg-input p-2"
          >
            {groups.length === 0 ? (
              <p className="px-3 py-6 text-center text-caption text-muted-foreground">
                {t('settings.providerSwitchNoCandidate')}
              </p>
            ) : visibleGroups.length === 0 ? (
              <p className="px-3 py-6 text-center text-caption text-muted-foreground">
                {t('settings.providerModelSearchEmpty')}
              </p>
            ) : (
              visibleGroups.map((group) => (
                <div key={group.providerKey} className="mb-2 last:mb-0">
                  <div className="flex items-center justify-between gap-2 px-2 py-1 text-caption font-medium text-muted-foreground">
                    <span className="truncate">{group.providerName}</span>
                    <span className="shrink-0 rounded-inner border border-border px-1 text-micro text-muted-foreground">
                      {group.kind === 'subscription'
                        ? t('settings.providerKindSubscription')
                        : t('settings.providerKindCustom')}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {group.models.map((model) => {
                      const active = selected?.providerId === group.providerId && selected?.model === model;
                      return (
                        <button
                          key={`${group.providerId}:${model}`}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          disabled={pending || busy}
                          data-replacement-provider={group.providerId}
                          data-replacement-model={model}
                          onClick={() => {
                            setSelected({ providerId: group.providerId, model });
                            setWarning('');
                            setError('');
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-card border px-3 py-2 text-left transition-colors disabled:opacity-60',
                            active
                              ? 'border-border-strong bg-card-active'
                              : 'border-transparent hover:bg-card-hover',
                          )}
                        >
                          <ModelOptionRow
                            modelId={model}
                            providerName={group.providerName}
                            selected={active}
                            size="comfortable"
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {warning ? (
          <p className="shrink-0 border-t border-border-subtle px-5 py-2 text-caption text-warning" role="alert">
            {warning}
          </p>
        ) : null}
        {error ? (
          <p className="shrink-0 border-t border-border-subtle px-5 py-2 text-caption text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle bg-popover px-5 py-3">
          <Button variant="ghost" size="sm" type="button" disabled={pending} onClick={onClose}>
            {t('settings.cancel')}
          </Button>
          <Button
            size="sm"
            type="button"
            disabled={!selected || groups.length === 0 || pending || busy}
            onClick={() => { void confirm(Boolean(warning)); }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
