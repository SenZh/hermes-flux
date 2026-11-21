import * as React from 'react';
import { Check, Plus, RefreshCw, Search, X } from 'lucide-react';
import {
  validateAndBuildMcpAddParams,
  type McpCatalogItem,
  type McpServerAddDraft,
  type McpServerAddRpcParams,
  type McpTransportKind,
} from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import { Badge } from '../primitives/Badge.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { Surface } from '../primitives/Surface.js';
import { Textarea } from '../primitives/Textarea.js';
import { SegmentedControl } from './SegmentedControl.js';
import { SettingField } from './SettingRow.js';
import type { SettingsActionResult } from './settingsModel.js';

/**
 * 新增 MCP 服务器弹窗（预设目录 + 自定义 stdio / HTTP 配置）。
 *
 * 【设计意图 (Why)】
 *   「BOT 能力矩阵」与「设置 › 扩展」共用这一个弹窗组件（禁止双标实现）。
 *   所有参数解析、环境变量行检验与 URL 合法性检验全部交由 `@hermes-flux/core`
 *   的纯函数 `validateAndBuildMcpAddParams` 完成，弹窗只承载受控草稿与反馈。
 *
 * 【约束与规则 (Rules)】
 *   1. 使用 `Dialog` 原语 + `portal={false}` + `max-h-modal-md` 约束弹窗高度；
 *   2. 所有文案走 `t()`，严禁裸色字面量与非整数网格间距；
 *   3. 预设添加与自定义提交共享同一条成功关闭 + 失败保窗规则（不丢失已填表单）。
 */

export interface McpAddDialogProps {
  open: boolean;
  targetProfile: string;
  targetLabel: string;
  installedNames: ReadonlySet<string>;
  onClose: () => void;
  onFetchCatalog?: (
    profile: string,
  ) => Promise<{ ok: boolean; items: McpCatalogItem[]; message?: string }>;
  onAddServer?: (
    profile: string,
    params: Omit<McpServerAddRpcParams, 'profile'>,
  ) => Promise<SettingsActionResult & { name?: string }>;
  onNotify: (message: string) => void;
}

const INITIAL_DRAFT: McpServerAddDraft = {
  mode: 'preset',
  name: '',
  preset: '',
  transport: 'stdio',
  command: '',
  argsText: '',
  envText: '',
  url: '',
  bearerToken: '',
};

function resolveValidationMessage(
  reason: 'nameRequired' | 'nameInvalid' | 'presetRequired' | 'commandRequired' | 'urlRequired' | 'urlInvalid' | 'envInvalid',
  invalidLine?: string,
): string {
  switch (reason) {
    case 'nameRequired':
      return t('bot.mcpErrNameRequired');
    case 'nameInvalid':
      return t('bot.mcpErrNameInvalid');
    case 'presetRequired':
      return t('bot.mcpErrPresetRequired');
    case 'commandRequired':
      return t('bot.mcpErrCommandRequired');
    case 'urlRequired':
      return t('bot.mcpErrUrlRequired');
    case 'urlInvalid':
      return t('bot.mcpErrUrlInvalid');
    case 'envInvalid':
      return t('bot.mcpErrEnvInvalid', { line: invalidLine ?? '' });
  }
}

export function McpAddDialog({
  open,
  targetProfile,
  targetLabel,
  installedNames,
  onClose,
  onFetchCatalog,
  onAddServer,
  onNotify,
}: McpAddDialogProps): React.ReactElement | null {
  const [draft, setDraft] = React.useState<McpServerAddDraft>(INITIAL_DRAFT);
  const [catalogQuery, setCatalogQuery] = React.useState('');
  const [catalog, setCatalog] = React.useState<{ loading: boolean; items: McpCatalogItem[]; error?: string }>({
    loading: false,
    items: [],
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const loadSeqRef = React.useRef(0);

  const fetchCatalog = React.useCallback(async () => {
    if (!onFetchCatalog) return;
    const seq = ++loadSeqRef.current;
    setCatalog((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const result = await onFetchCatalog(targetProfile);
      if (seq !== loadSeqRef.current) return;
      if (!result.ok) {
        setCatalog({ loading: false, items: [], error: result.message || t('settings.loadFailed') });
        return;
      }
      setCatalog({ loading: false, items: result.items });
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setCatalog({
        loading: false,
        items: [],
        error: err instanceof Error && err.message ? err.message : t('settings.loadFailed'),
      });
    }
  }, [onFetchCatalog, targetProfile]);

  React.useEffect(() => {
    if (!open) return;
    setDraft(INITIAL_DRAFT);
    setCatalogQuery('');
    setError(undefined);
    setSubmitting(false);
    void fetchCatalog();
  }, [open, fetchCatalog]);

  if (!open) return null;

  const filteredCatalog = catalog.items.filter((item) => {
    const q = catalogQuery.trim().toLowerCase();
    if (!q) return true;
    return item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
  });

  const submitDraft = async (nextDraft: McpServerAddDraft): Promise<void> => {
    if (!onAddServer || submitting) return;
    const validated = validateAndBuildMcpAddParams(nextDraft);
    if (!validated.ok) {
      setError(resolveValidationMessage(validated.reason, validated.invalidLine));
      return;
    }
    setSubmitting(true);
    setError(undefined);
    const { profile: _ignored, ...rest } = validated.params;
    try {
      const result = await onAddServer(targetProfile, rest);
      if (!result.ok) {
        setError(t('bot.mcpAddFailed', { message: result.message || t('settings.loadFailed') }));
        return;
      }
      onNotify(t('bot.mcpAdded', { name: result.name || validated.params.name }));
      onClose();
    } catch (err) {
      setError(
        t('bot.mcpAddFailed', {
          message: err instanceof Error && err.message ? err.message : t('settings.loadFailed'),
        }),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const selectPreset = (item: McpCatalogItem): void => {
    setError(undefined);
    if (item.requires.length === 0) {
      void submitDraft({
        ...INITIAL_DRAFT,
        mode: 'preset',
        name: item.name,
        preset: item.name,
      });
      return;
    }
    setDraft((prev) => ({
      ...prev,
      mode: 'preset',
      preset: item.name,
      name: prev.preset === item.name && prev.name ? prev.name : item.name,
      bearerToken: '',
    }));
  };

  const selectedPreset = catalog.items.find((item) => item.name === draft.preset) ?? null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !submitting) onClose();
      }}
    >
      <DialogContent
        portal={false}
        data-mcp-add-dialog="true"
        className="flex max-h-modal-md w-full max-w-2xl flex-col gap-0 overflow-hidden rounded-window p-0"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-section font-semibold text-foreground">{t('bot.mcpAddTitle')}</DialogTitle>
            <DialogDescription className="mt-1 text-caption text-muted-foreground">
              {t('bot.mcpAddDesc', { bot: targetLabel })}
            </DialogDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={submitting}
            aria-label={t('settings.close')}
            onClick={onClose}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-panel px-5 py-3">
          <SegmentedControl
            value={draft.mode}
            ariaLabel={t('bot.mcpAddTitle')}
            onChange={(mode) => {
              setError(undefined);
              setDraft((prev) => ({ ...prev, mode }));
            }}
            options={[
              { value: 'preset', label: t('bot.mcpAddPresetTab') },
              { value: 'custom', label: t('bot.mcpAddCustomTab') },
            ]}
          />
          {draft.mode === 'preset' ? (
            <div className="relative min-w-44 flex-1 max-w-64">
              <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                size="xs"
                value={catalogQuery}
                onChange={(event) => setCatalogQuery(event.target.value)}
                placeholder={t('bot.mcpCatalogSearchPlaceholder')}
                aria-label={t('bot.mcpCatalogSearchPlaceholder')}
                className="pl-7"
              />
            </div>
          ) : null}
        </div>

        <div data-mcp-add-scroll="true" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-4">
          {error ? (
            <p role="alert" className="rounded-card border border-destructive/30 bg-panel px-3 py-2 text-caption text-destructive">
              {error}
            </p>
          ) : null}

          {draft.mode === 'preset' ? (
            <div className="flex flex-col gap-3">
              {selectedPreset ? (
                <Surface level="panel" padding="normal" className="flex shrink-0 flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-body font-medium text-foreground">{selectedPreset.name}</span>
                    <Badge variant="secondary" className="font-code text-micro">{selectedPreset.transport}</Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <SettingField label={t('bot.mcpNameLabel')} htmlFor="mcp-preset-alias">
                      <Input
                        id="mcp-preset-alias"
                        size="sm"
                        value={draft.name}
                        disabled={submitting}
                        placeholder={t('bot.mcpNamePlaceholder')}
                        onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                        className="font-code"
                      />
                    </SettingField>
                    <SettingField label={t('bot.mcpBearerLabel')} htmlFor="mcp-preset-token">
                      <Input
                        id="mcp-preset-token"
                        type="password"
                        size="sm"
                        value={draft.bearerToken}
                        disabled={submitting}
                        placeholder={t('bot.mcpBearerPlaceholder')}
                        onChange={(event) => setDraft((prev) => ({ ...prev, bearerToken: event.target.value }))}
                        className="font-code"
                      />
                    </SettingField>
                  </div>
                </Surface>
              ) : null}

              {catalog.loading ? (
                <p className="py-6 text-center text-caption text-muted-foreground">{t('bot.mcpCatalogLoading')}</p>
              ) : catalog.error ? (
                <div className="flex items-center justify-between gap-3 rounded-card border border-destructive/30 bg-panel px-4 py-3">
                  <span className="text-caption text-destructive">{catalog.error}</span>
                  <Button type="button" variant="outline" size="xs" onClick={() => void fetchCatalog()}>
                    <RefreshCw aria-hidden="true" className="size-3" />
                    {t('bot.retry')}
                  </Button>
                </div>
              ) : filteredCatalog.length === 0 ? (
                <p className="py-6 text-center text-caption text-muted-foreground">{t('bot.mcpCatalogEmpty')}</p>
              ) : (
                <Surface level="panel" padding="none" className="flex shrink-0 flex-col overflow-hidden">
                  {filteredCatalog.map((item) => {
                    const installed = item.installed || installedNames.has(item.name);
                    const picked = draft.preset === item.name;
                    return (
                      <div
                        key={item.name}
                        className="flex items-center justify-between gap-4 border-b border-border-subtle px-4 py-3 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-code text-body font-medium text-foreground">{item.name}</span>
                            <Badge variant="secondary" className="font-code text-micro">{item.transport}</Badge>
                          </div>
                          {item.description ? (
                            <p className="mt-1 text-caption text-muted-foreground">{item.description}</p>
                          ) : null}
                          {item.requires.length > 0 ? (
                            <p className="mt-1 font-code text-micro text-muted-foreground">
                              {t('bot.mcpPresetRequires', { vars: item.requires.join(', ') })}
                            </p>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          size="xs"
                          variant={installed ? 'ghost' : picked ? 'default' : 'outline'}
                          disabled={installed || submitting}
                          onClick={() => selectPreset(item)}
                        >
                          {installed ? (
                            <>
                              <Check aria-hidden="true" className="size-3" />
                              {t('bot.mcpPresetInstalled')}
                            </>
                          ) : (
                            <>
                              <Plus aria-hidden="true" className="size-3" />
                              {t('bot.mcpPresetInstall')}
                            </>
                          )}
                        </Button>
                      </div>
                    );
                  })}
                </Surface>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <SettingField label={t('bot.mcpNameLabel')} htmlFor="mcp-custom-name">
                  <Input
                    id="mcp-custom-name"
                    size="sm"
                    value={draft.name}
                    disabled={submitting}
                    placeholder={t('bot.mcpNamePlaceholder')}
                    onChange={(event) => {
                      setError(undefined);
                      setDraft((prev) => ({ ...prev, name: event.target.value }));
                    }}
                    className="font-code"
                  />
                </SettingField>
                <SettingField label={t('bot.mcpTransportLabel')}>
                  <SegmentedControl<McpTransportKind>
                    value={draft.transport}
                    ariaLabel={t('bot.mcpTransportLabel')}
                    onChange={(transport) => {
                      setError(undefined);
                      setDraft((prev) => ({ ...prev, transport }));
                    }}
                    options={[
                      { value: 'stdio', label: t('bot.mcpTransportStdio') },
                      { value: 'http', label: t('bot.mcpTransportHttp') },
                    ]}
                  />
                </SettingField>
              </div>

              {draft.transport === 'stdio' ? (
                <>
                  <SettingField label={t('bot.mcpCommandLabel')} htmlFor="mcp-custom-command">
                    <Input
                      id="mcp-custom-command"
                      size="sm"
                      value={draft.command}
                      disabled={submitting}
                      placeholder={t('bot.mcpCommandPlaceholder')}
                      onChange={(event) => {
                        setError(undefined);
                        setDraft((prev) => ({ ...prev, command: event.target.value }));
                      }}
                      className="font-code"
                    />
                  </SettingField>
                  <SettingField label={t('bot.mcpArgsLabel')} htmlFor="mcp-custom-args">
                    <Input
                      id="mcp-custom-args"
                      size="sm"
                      value={draft.argsText}
                      disabled={submitting}
                      placeholder={t('bot.mcpArgsPlaceholder')}
                      onChange={(event) => {
                        setError(undefined);
                        setDraft((prev) => ({ ...prev, argsText: event.target.value }));
                      }}
                      className="font-code"
                    />
                  </SettingField>
                  <SettingField label={t('bot.mcpEnvLabel')} htmlFor="mcp-custom-env">
                    <Textarea
                      id="mcp-custom-env"
                      size="sm"
                      rows={3}
                      value={draft.envText}
                      disabled={submitting}
                      placeholder={t('bot.mcpEnvPlaceholder')}
                      onChange={(event) => {
                        setError(undefined);
                        setDraft((prev) => ({ ...prev, envText: event.target.value }));
                      }}
                      className="font-code text-aux"
                    />
                  </SettingField>
                </>
              ) : (
                <>
                  <SettingField label={t('bot.mcpUrlLabel')} htmlFor="mcp-custom-url">
                    <Input
                      id="mcp-custom-url"
                      size="sm"
                      value={draft.url}
                      disabled={submitting}
                      placeholder={t('bot.mcpUrlPlaceholder')}
                      onChange={(event) => {
                        setError(undefined);
                        setDraft((prev) => ({ ...prev, url: event.target.value }));
                      }}
                      className="font-code"
                    />
                  </SettingField>
                  <SettingField label={t('bot.mcpBearerLabel')} htmlFor="mcp-custom-bearer">
                    <Input
                      id="mcp-custom-bearer"
                      type="password"
                      size="sm"
                      value={draft.bearerToken}
                      disabled={submitting}
                      placeholder={t('bot.mcpBearerPlaceholder')}
                      onChange={(event) => {
                        setError(undefined);
                        setDraft((prev) => ({ ...prev, bearerToken: event.target.value }));
                      }}
                      className="font-code"
                    />
                  </SettingField>
                </>
              )}
            </div>
          )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={onClose}>
            {t('settings.cancel')}
          </Button>
          {draft.mode === 'custom' || selectedPreset ? (
            <Button
              type="button"
              size="sm"
              disabled={submitting || !onAddServer}
              onClick={() => {
                void submitDraft(draft);
              }}
            >
              {submitting ? t('bot.mcpAdding') : t('bot.mcpAddSubmit')}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
