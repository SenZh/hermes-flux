import * as React from 'react';
import { Eye, EyeOff, Server, User, X } from 'lucide-react';
import {
  deriveEndpointId,
  type CustomEndpointRow,
  type EndpointProbe,
} from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { FanOutMemberList } from './FanOutMemberList.js';
import { LoadBoundary } from './LoadBoundary.js';
import { LoginPanel, type LoginState } from './LoginPanel.js';
import { ModelPickerField } from './ModelPicker.js';
import {
  applyProbeResultToDraft,
  buildSaveEndpointOptions,
  createOAuthLoginCoordinator,
  defaultSelectedProfiles,
  formatFanOutWarning,
  formReducer,
  hasStoredEndpointKey,
  initialFormState,
  type OAuthLoginCoordinator,
} from './providerDialogLogic.js';
import { SegmentedControl } from './SegmentedControl.js';
import { SettingField, SettingTwoColumn } from './SettingRow.js';
import type { SettingsActions, SettingsBotRow, SettingsSnapshot } from './settingsModel.js';

export type AddProviderTab = 'subscription' | 'custom';

/**
 * 探测结果。
 *
 * 【设计意图 (Why)】
 *   网关返回的 detail 常含英文原文且混杂传输告警与 401 鉴权失败，
 *   这里拆成「中文结论 + 原始次要信息」两层，保证用户一眼读懂下一步该改地址还是改密钥。
 */
function ProbeLine({ probe }: { probe: EndpointProbe }): React.ReactElement {
  if (probe.kind === 'ok') {
    return (
      <div className="rounded-card border border-border-subtle bg-card px-3 py-2">
        <p className="text-caption text-success" role="status">
          {t('settings.providerTestOk', { count: probe.modelCount })}
        </p>
      </div>
    );
  }
  const authFailed =
    probe.kind === 'warning' && /api key|unauthor|\b401\b|reject/i.test(probe.message || '');
  const headline =
    probe.kind === 'unreachable'
      ? t('settings.providerTestUnreachable')
      : authFailed
        ? t('settings.providerTestAuthFailed')
        : t('settings.customEndpointProbeWarning');
  const tone = probe.kind === 'unreachable' || authFailed ? 'text-destructive' : 'text-warning';
  return (
    <div className="rounded-card border border-border-subtle bg-card px-3 py-2" role="alert">
      <p className={`text-caption ${tone}`}>{headline}</p>
      {probe.message ? (
        <p className="mt-1 text-caption text-muted-foreground">
          {t('settings.providerTestDetailsLine', { message: probe.message })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 添加 / 编辑提供商弹窗。
 *
 * 【设计意图 (Why)】
 *   把添加订阅与配置自定义端点的低频流程收进专注模态层，采用
 *   「固定顶栏 + 双列页签（仅新增态）+ 发丝线分隔扁平表单（SettingTwoColumn）+ 固定底栏」结构：
 *   1. 新建自定义端点时不锁任何默认 BOT，用户自由点选要开启的 BOT；
 *   2. 保存始终保持 `makeDefault: false`，绝不顺手篡改任何 BOT 的当前默认模型；
 *   3. 编辑模式把已开启成员作为 `targetProfiles` 同步写入，保证列表提示与实际落盘一致。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. `useEffect` 若把 `bots` / `defaultProfile` 放进无防抖重置分支，背景快照刷新会清空用户正在填写的草稿；
 *      现在按开窗会话 key 切换才重置，打开期间刷新外围快照绝不丢草稿；
 *   2. 轮询设备码登录若不追踪定时器与代次令牌，关闭/卸载后仍会在后台每 3 秒请求网关；
 *      全部收归 `createOAuthLoginCoordinator` 与 `opEpochRef`，关闭、取消与卸载恒清净。
 *
 * 【约束与规则 (Rules)】
 *   1. 高度受 `max-h-modal-md` 约束，宽度 `max-w-xl`，分区用发丝线分隔（bg-border-subtle）+ 4px 整数网格，避免多层嵌套边框；
 *   2. 所有 `window.setTimeout` 仅由 `oauthRef` 统一管理并在关闭与卸载时 `dispose()`；
 *   3. `portal={false}` 不可省略（遵循 `primitives/Dialog` 的设置作用域与 SSR 规则）。
 */
export function AddProviderDialog({
  open,
  onClose,
  bots,
  defaultProfile,
  snapshot,
  actions,
  editing,
  editingProfiles,
  defaultTab = 'subscription',
}: {
  open: boolean;
  onClose: () => void;
  bots: readonly SettingsBotRow[];
  defaultProfile: string;
  snapshot: SettingsSnapshot;
  actions: SettingsActions;
  editing: CustomEndpointRow | null;
  editingProfiles?: readonly string[];
  defaultTab?: AddProviderTab;
}): React.ReactElement | null {
  const isEditing = Boolean(editing);
  const [tab, setTab] = React.useState<AddProviderTab>(() => (editing ? 'custom' : defaultTab));
  const [login, setLogin] = React.useState<LoginState | null>(null);
  const [showKey, setShowKey] = React.useState(false);
  const [form, dispatch] = React.useReducer(
    formReducer,
    undefined,
    () => initialFormState(editing, editingProfiles, bots, defaultProfile),
  );

  // 用 ref 读取最新动作回调，避免匿名函数引用变化导致轮询器重建或卸载错杀。
  const actionsRef = React.useRef(actions);
  actionsRef.current = actions;
  const initInputsRef = React.useRef({ bots, defaultProfile, editing, editingProfiles, defaultTab });
  initInputsRef.current = { bots, defaultProfile, editing, editingProfiles, defaultTab };

  const oauthRef = React.useRef<OAuthLoginCoordinator | null>(null);
  if (!oauthRef.current) {
    oauthRef.current = createOAuthLoginCoordinator({
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
      onStartLogin: (providerId) => actionsRef.current.onStartLogin(providerId),
      onPollLogin: (providerId, sessionId) => actionsRef.current.onPollLogin(providerId, sessionId),
      onCancelLogin: (sessionId) => actionsRef.current.onCancelLogin(sessionId),
      onReloadProviders: () => actionsRef.current.onReloadProviders(),
      onStateChange: (next) => setLogin(next),
    });
  }

  /** 保护在途 `probe` / `save` 的代数令牌，关闭或重开后作废迟滞回写。 */
  const opEpochRef = React.useRef(0);
  const prevSessionKeyRef = React.useRef<string>(
    open ? (editing ? `edit:${editing.id}` : 'add') : 'closed',
  );

  // 卸载时强制销毁设备码轮询定时器并撤回挂起会话。
  React.useEffect(
    () => () => {
      opEpochRef.current += 1;
      oauthRef.current?.dispose();
    },
    [],
  );

  // 只在「开关弹窗」或「切换编辑目标」时重置表单，绝不在打开期间因外围快照更新抹掉用户输入。
  const sessionKey = open ? (editing ? `edit:${editing.id}` : 'add') : 'closed';
  React.useEffect(() => {
    if (prevSessionKeyRef.current === sessionKey) return;
    prevSessionKeyRef.current = sessionKey;
    opEpochRef.current += 1;
    oauthRef.current?.dispose();
    setShowKey(false);
    if (!open) {
      setTab(initInputsRef.current.defaultTab);
      return;
    }
    const latest = initInputsRef.current;
    if (latest.editing) {
      setTab('custom');
      dispatch({ type: 'edit', row: latest.editing, enabledProfiles: [...(latest.editingProfiles ?? [])] });
      return;
    }
    setTab(latest.defaultTab);
    dispatch({
      type: 'initAdd',
      initialProfiles: defaultSelectedProfiles(latest.bots, latest.defaultProfile),
    });
  }, [sessionKey, open]);

  const closeWithCleanup = (): void => {
    opEpochRef.current += 1;
    oauthRef.current?.dispose();
    setShowKey(false);
    const latest = initInputsRef.current;
    dispatch({ type: 'initAdd', initialProfiles: defaultSelectedProfiles(latest.bots, latest.defaultProfile) });
    prevSessionKeyRef.current = 'closed';
    onClose();
  };

  if (!open) return null;

  const { draft } = form;
  const derivedId = draft.id || deriveEndpointId(draft.name);
  const hasStoredKey = isEditing && hasStoredEndpointKey(editing);
  // 新建必须带明文密钥；编辑留空表示保留原密钥。
  const keyMissing = !isEditing && draft.apiKey.kind !== 'set';
  const noBotsSelected = !isEditing && bots.length > 0 && form.selectedProfiles.length === 0;
  const busy = snapshot.providerAdminBusy;
  const disabled = busy || form.savePending;
  const saveDisabled =
    disabled
    || keyMissing
    || noBotsSelected
    || !draft.name.trim()
    || !draft.baseUrl.trim()
    || !draft.model.trim();

  const probe = async (): Promise<void> => {
    const runEpoch = opEpochRef.current;
    dispatch({ type: 'probeStart' });
    try {
      const result = await actionsRef.current.onProbeEndpoint(draft);
      if (runEpoch !== opEpochRef.current) return;
      dispatch({ type: 'probeResult', probe: result });
      const patch = applyProbeResultToDraft(draft, result);
      if (patch) dispatch({ type: 'field', patch });
    } catch (error: unknown) {
      if (runEpoch !== opEpochRef.current) return;
      dispatch({
        type: 'probeResult',
        probe: {
          kind: 'warning',
          message: error instanceof Error ? error.message : t('settings.providerToggleFailed'),
        },
      });
    }
  };

  const save = async (): Promise<void> => {
    const runEpoch = opEpochRef.current;
    if (isEditing && editingProfiles !== undefined && editingProfiles.length === 0) {
      dispatch({ type: 'saveResult', ok: false, message: t('settings.providerEditUnavailable') });
      return;
    }
    dispatch({ type: 'saveStart' });
    const saveOptions = buildSaveEndpointOptions(isEditing, form.selectedProfiles, editingProfiles);
    try {
      const outcome = await actionsRef.current.onSaveEndpoint(draft, saveOptions);
      if (runEpoch !== opEpochRef.current) return;
      if (!outcome.ok) {
        dispatch({ type: 'saveResult', ok: false, message: outcome.message || t('settings.saveFailed') });
        return;
      }
      const failed = (outcome.fanOut || []).filter((item) => !item.ok);
      if (failed.length > 0) {
        // 部分 BOT 写入失败时保留弹窗，让用户看到具体失败的 BOT。
        dispatch({
          type: 'saveResult',
          ok: true,
          warning: formatFanOutWarning(
            t('settings.customEndpointFanOutPartial'),
            failed.map((item) => item.displayName),
          ),
        });
        return;
      }
      actionsRef.current.onNotify(t('settings.customEndpointSaved'));
      closeWithCleanup();
    } catch (error: unknown) {
      if (runEpoch !== opEpochRef.current) return;
      dispatch({
        type: 'saveResult',
        ok: false,
        message: error instanceof Error ? error.message : t('settings.saveFailed'),
      });
    }
  };

  const headerHint = isEditing
    ? t('settings.editCustomHint')
    : tab === 'subscription'
      ? t('settings.addSubscriptionHint')
      : t('settings.addCustomHint');

  const keyPlaceholder = keyMissing
    ? t('settings.customEndpointKeyRequired')
    : draft.apiKey.kind === 'clear'
      ? t('settings.customEndpointKeyClearPending')
      : hasStoredKey
        ? t('settings.customEndpointKeyKeep')
        : '';

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) closeWithCleanup();
      }}
    >
      <DialogContent
        portal={false}
        className="flex max-h-modal-md w-full max-w-xl flex-col gap-0 overflow-hidden rounded-window p-0"
      >
        <div className="shrink-0 border-b border-border-subtle px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="truncate text-section font-medium text-foreground">
              {isEditing ? t('settings.editTitle') : t('settings.addTitle')}
            </DialogTitle>
            <DialogDescription className="sr-only">{headerHint}</DialogDescription>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              className="shrink-0"
              aria-label={t('settings.close')}
              onClick={closeWithCleanup}
            >
              <X size={14} aria-hidden="true" />
            </Button>
          </div>
        </div>

        {/* 添加模式提供清晰满宽双列页签；编辑态锁定在自定义端点，绝不出现页签。 */}
        {isEditing ? null : (
          <div className="shrink-0 px-5 pt-4">
            <SegmentedControl
              variant="tabs"
              ariaLabel={t('settings.addTitle')}
              value={tab}
              onChange={(next) => {
                setTab(next);
                if (next === 'custom' && !login) {
                  dispatch({
                    type: 'initAdd',
                    initialProfiles: defaultSelectedProfiles(bots, defaultProfile),
                  });
                }
              }}
              options={[
                { value: 'subscription', label: t('settings.addTabSubscription'), icon: <User size={14} /> },
                { value: 'custom', label: t('settings.addTabCustom'), icon: <Server size={14} /> },
              ]}
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'subscription' ? (
            <div className="flex flex-col gap-3">
              {login ? (
                <LoginPanel
                  state={login}
                  onCancel={() => oauthRef.current?.dispose()}
                  onCopy={(text) => { void actionsRef.current.onCopy(text); }}
                />
              ) : null}
              <LoadBoundary
                state={snapshot.subscriptionCatalog}
                onRetry={actionsRef.current.onReloadProviders}
                emptyLabel={t('settings.addSubscriptionEmpty')}
              >
                {(rows) => {
                  const available = rows.filter((row) => !row.loggedIn);
                  if (available.length === 0) {
                    return <p className="py-6 text-center text-body text-muted-foreground">{t('settings.addSubscriptionEmpty')}</p>;
                  }
                  return (
                    <div className="flex flex-col rounded-card border border-border-subtle bg-input px-3">
                      {available.map((row) => (
                        <div
                          key={row.id}
                          className="flex items-center justify-between gap-3 border-b border-border-subtle py-3 last:border-b-0"
                          data-subscription-id={row.id}
                        >
                          <div className="min-w-0">
                            <span className="block truncate text-body font-medium text-foreground">{row.name}</span>
                            {row.flow === 'external' && row.cliCommand ? (
                              <p className="mt-1 truncate font-code text-caption text-muted-foreground">{row.cliCommand}</p>
                            ) : null}
                          </div>
                          {row.flow === 'external' ? (
                            <div className="flex shrink-0 items-center gap-1">
                              <span className="text-caption text-muted-foreground">{t('settings.loginManual')}</span>
                              {row.cliCommand ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  type="button"
                                  onClick={() => { void actionsRef.current.onCopy(row.cliCommand!); }}
                                >
                                  {t('settings.loginCopyCommand')}
                                </Button>
                              ) : null}
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              type="button"
                              disabled={Boolean(login) || busy}
                              onClick={() => { void oauthRef.current?.start(row.id); }}
                            >
                              {t('settings.providerLogin')}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                }}
              </LoadBoundary>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <SettingTwoColumn>
                <SettingField label={t('settings.customEndpointName')} htmlFor="provider-endpoint-name">
                  <Input
                    id="provider-endpoint-name"
                    value={draft.name}
                    placeholder={t('settings.customEndpointNamePlaceholder')}
                    onChange={(event) => dispatch({ type: 'field', patch: { name: event.target.value } })}
                  />
                </SettingField>
                <SettingField label={t('settings.customEndpointId')} htmlFor="provider-endpoint-id">
                  <Input
                    id="provider-endpoint-id"
                    value={draft.id}
                    readOnly={isEditing}
                    aria-readonly={isEditing}
                    title={isEditing ? t('settings.customEndpointIdLocked') : undefined}
                    placeholder={derivedId || 'internal-gateway'}
                    onChange={(event) => dispatch({ type: 'field', patch: { id: event.target.value } })}
                    className={isEditing ? 'font-code cursor-not-allowed text-muted-foreground' : 'font-code'}
                  />
                </SettingField>
              </SettingTwoColumn>

              <SettingField label={t('settings.customEndpointUrl')} htmlFor="provider-endpoint-url">
                <Input
                  id="provider-endpoint-url"
                  value={draft.baseUrl}
                  placeholder="https://llm.internal/v1"
                  onChange={(event) => dispatch({ type: 'field', patch: { baseUrl: event.target.value } })}
                  className="font-code"
                />
              </SettingField>

              <SettingField
                label={t('settings.customEndpointKey')}
                htmlFor="provider-endpoint-key"
                meta={form.probe?.kind === 'ok' ? (
                  <span className="text-caption text-success" role="status">
                    {t('settings.providerTestOk', { count: form.probe.modelCount })}
                  </span>
                ) : undefined}
              >
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Input
                      id="provider-endpoint-key"
                      type={showKey ? 'text' : 'password'}
                      autoComplete="off"
                      value={draft.apiKey.kind === 'set' ? draft.apiKey.value : ''}
                      placeholder={keyPlaceholder}
                      onChange={(event) =>
                        dispatch({
                          type: 'field',
                          patch: { apiKey: event.target.value ? { kind: 'set', value: event.target.value } : { kind: 'keep' } },
                        })
                      }
                      className="pr-9 font-code"
                    />
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      type="button"
                      aria-label={showKey ? t('settings.customEndpointKeyHide') : t('settings.customEndpointKeyShow')}
                      onClick={() => setShowKey((prev) => !prev)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showKey ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                    </Button>
                  </div>
                  {hasStoredKey && draft.apiKey.kind !== 'clear' ? (
                    <Button
                      variant="outline"
                      type="button"
                      className="shrink-0 whitespace-nowrap"
                      onClick={() => dispatch({ type: 'field', patch: { apiKey: { kind: 'clear' } } })}
                    >
                      {t('settings.customEndpointKeyClear')}
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    type="button"
                    className="shrink-0 whitespace-nowrap"
                    disabled={disabled || form.probePending || !draft.baseUrl.trim()}
                    onClick={() => { void probe(); }}
                  >
                    {form.probePending ? t('settings.customEndpointTesting') : t('settings.customEndpointTest')}
                  </Button>
                </div>
              </SettingField>

              {form.probe && form.probe.kind !== 'ok' ? <ProbeLine probe={form.probe} /> : null}

              <div className="h-px bg-border-subtle" />

              <SettingField
                label={t('settings.customEndpointModel')}
                meta={draft.models && draft.models.length > 0 ? (
                  <span className="text-caption text-muted-foreground">
                    {t('settings.providerModels', { count: draft.models.length })}
                  </span>
                ) : undefined}
              >
                <ModelPickerField
                  value={draft.model}
                  models={draft.models ?? []}
                  providerName={draft.name || draft.id}
                  placeholder="gpt-5.4"
                  ariaLabel={t('settings.customEndpointModel')}
                  onChange={(model) => dispatch({ type: 'field', patch: { model } })}
                />
              </SettingField>

              {!isEditing && bots.length > 0 ? (
                <>
                  <div className="h-px bg-border-subtle" />
                  <div
                    role="group"
                    aria-labelledby="custom-endpoint-apply-to"
                    className="flex min-w-0 flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span id="custom-endpoint-apply-to" className="text-aux text-muted-foreground">
                        {t('settings.customEndpointApplyTo')}
                      </span>
                      <span className="shrink-0 text-caption text-muted-foreground">
                        {t('settings.customEndpointApplyToCount', {
                          selected: form.selectedProfiles.length,
                          total: bots.length,
                        })}
                      </span>
                    </div>
                    <div className="rounded-card border border-border-subtle bg-input px-3 py-2">
                      <FanOutMemberList
                        bots={bots}
                        selected={form.selectedProfiles}
                        onToggle={(profile) => dispatch({ type: 'toggleProfile', profile })}
                      />
                    </div>
                    {form.selectedProfiles.length === 0 ? (
                      <p className="text-caption text-warning" role="alert">
                        {t('settings.customEndpointApplyToEmpty')}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>

        {tab === 'custom' && (form.error || form.warning || form.notice) ? (
          <div className="shrink-0 border-t border-border-subtle bg-panel px-5 py-2">
            {form.error ? (
              <p className="text-caption text-destructive" role="alert">
                {form.error}
              </p>
            ) : null}
            {form.warning ? (
              <p className="text-caption text-warning" role="status">
                {form.warning}
              </p>
            ) : null}
            {form.notice ? (
              <p className="text-caption text-success" role="status">
                {form.notice}
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === 'custom' ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border-subtle bg-popover px-5 py-3">
            {isEditing ? (
              <span className="text-caption text-muted-foreground">
                {t('settings.customEndpointMembersHint', { count: editingProfiles?.length ?? 0 })}
              </span>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" type="button" onClick={closeWithCleanup}>
                {t('settings.cancel')}
              </Button>
              <Button
                size="sm"
                type="button"
                disabled={saveDisabled}
                onClick={() => { void save(); }}
              >
                {form.savePending ? t('settings.customEndpointSaving') : t('settings.customEndpointSave')}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
