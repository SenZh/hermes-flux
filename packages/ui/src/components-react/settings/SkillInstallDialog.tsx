import * as React from 'react';
import { Check, Download, Search, X } from 'lucide-react';
import type { SkillHubSearchResult } from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import { Badge } from '../primitives/Badge.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { Surface } from '../primitives/Surface.js';
import type { SettingsActionResult } from './settingsModel.js';

/**
 * 技能市场检索与安装弹窗（BOT 能力矩阵与扩展页共用）。
 *
 * 【设计意图 (Why)】
 *   网关支持 `skills.manage` 的 `browse` / `search` / `install` 与 `skills.reload`。
 *   通过独立二级弹窗承载浏览、关键词搜索、翻页与安装反馈，避免把市场浏览列表塞进
 *   主配置表格造成信息过载。
 *
 * 【约束与规则 (Rules)】
 *   1. 使用 `Dialog` 原语 + `portal={false}` + `max-h-modal-md`；
 *   2. 维护本次弹窗会话内新安装的技能集合，安装成功即刻切换为"已安装"不可重复触发；
 *   3. 所有文案走 `t()`，滚动区使用 `scrollbar-thin`。
 */

export interface SkillInstallDialogProps {
  open: boolean;
  targetProfile: string;
  installedNames: ReadonlySet<string>;
  onClose: () => void;
  onSearchSkills?: (
    profile: string,
    query: string,
    page?: number,
  ) => Promise<{ ok: boolean; data?: SkillHubSearchResult; message?: string }>;
  onInstallSkill?: (profile: string, name: string) => Promise<SettingsActionResult>;
  onNotify: (message: string) => void;
}

export function SkillInstallDialog({
  open,
  targetProfile,
  installedNames,
  onClose,
  onSearchSkills,
  onInstallSkill,
  onNotify,
}: SkillInstallDialogProps): React.ReactElement | null {
  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [state, setState] = React.useState<{
    loading: boolean;
    data: SkillHubSearchResult;
    error?: string;
  }>({
    loading: false,
    data: { rows: [], page: 1, totalPages: 1, total: 0 },
  });
  const [installingId, setInstallingId] = React.useState<string | null>(null);
  const [sessionInstalled, setSessionInstalled] = React.useState<Set<string>>(() => new Set());
  const seqRef = React.useRef(0);

  const runSearch = React.useCallback(
    async (nextQuery: string, nextPage: number) => {
      if (!onSearchSkills) return;
      const seq = ++seqRef.current;
      setState((prev) => ({ ...prev, loading: true, error: undefined }));
      try {
        const result = await onSearchSkills(targetProfile, nextQuery, nextPage);
        if (seq !== seqRef.current) return;
        if (!result.ok || !result.data) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: result.message || t('settings.loadFailed'),
          }));
          return;
        }
        setPage(result.data.page);
        setState({ loading: false, data: result.data });
      } catch (err) {
        if (seq !== seqRef.current) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error && err.message ? err.message : t('settings.loadFailed'),
        }));
      }
    },
    [onSearchSkills, targetProfile],
  );

  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setPage(1);
    setSessionInstalled(new Set());
    setInstallingId(null);
    void runSearch('', 1);
  }, [open, runSearch]);

  if (!open) return null;

  const handleInstall = async (skillRef: string, displayName: string): Promise<void> => {
    if (!onInstallSkill || installingId) return;
    setInstallingId(skillRef);
    try {
      const result = await onInstallSkill(targetProfile, skillRef);
      if (!result.ok) {
        setState((prev) => ({
          ...prev,
          error: t('bot.skillInstallFailed', { message: result.message || t('settings.loadFailed') }),
        }));
        return;
      }
      setSessionInstalled((prev) => {
        const next = new Set(prev);
        next.add(skillRef);
        next.add(displayName);
        return next;
      });
      onNotify(t('bot.skillInstalled', { name: displayName }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: t('bot.skillInstallFailed', {
          message: err instanceof Error && err.message ? err.message : t('settings.loadFailed'),
        }),
      }));
    } finally {
      setInstallingId(null);
    }
  };

  const { data } = state;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !installingId) onClose();
      }}
    >
      <DialogContent
        portal={false}
        data-skill-install-dialog="true"
        className="flex max-h-modal-md w-full max-w-2xl flex-col gap-0 overflow-hidden rounded-window p-0"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-section font-semibold text-foreground">{t('bot.skillHubTitle')}</DialogTitle>
            <DialogDescription className="mt-1 text-caption text-muted-foreground">
              {t('bot.skillHubDesc')}
            </DialogDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={Boolean(installingId)}
            aria-label={t('settings.close')}
            onClick={onClose}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>

        <form
          className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-panel px-5 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch(query, 1);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              size="sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('bot.skillHubSearchPlaceholder')}
              aria-label={t('bot.skillHubSearchPlaceholder')}
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={state.loading}>
            {t('bot.skillHubSearchAction')}
          </Button>
        </form>

        <div data-skill-install-scroll="true" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-3">
          {state.error ? (
            <p role="alert" className="rounded-card border border-destructive/30 bg-panel px-3 py-2 text-caption text-destructive">
              {state.error}
            </p>
          ) : null}

          {state.loading ? (
            <p className="py-8 text-center text-caption text-muted-foreground">{t('bot.skillHubLoading')}</p>
          ) : data.rows.length === 0 ? (
            <p className="py-8 text-center text-caption text-muted-foreground">{t('bot.skillHubEmpty')}</p>
          ) : (
            <Surface level="panel" padding="none" className="flex shrink-0 flex-col overflow-hidden">
              {data.rows.map((row) => {
                const refId = row.identifier || row.name;
                const installed =
                  row.installed ||
                  installedNames.has(row.name) ||
                  (row.identifier ? installedNames.has(row.identifier) : false) ||
                  sessionInstalled.has(row.name) ||
                  sessionInstalled.has(refId);
                const busyHere = installingId === refId;
                return (
                  <div
                    key={refId}
                    className="flex items-center justify-between gap-4 border-b border-border-subtle px-4 py-3 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-code text-body font-medium text-foreground">{row.name}</span>
                        {row.source ? <Badge variant="secondary" className="text-micro">{row.source}</Badge> : null}
                      </div>
                      {row.description ? (
                        <p className="mt-1 text-caption text-muted-foreground">{row.description}</p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      size="xs"
                      variant={installed ? 'ghost' : 'outline'}
                      disabled={installed || Boolean(installingId) || !onInstallSkill}
                      onClick={() => {
                        void handleInstall(refId, row.name);
                      }}
                    >
                      {installed ? (
                        <>
                          <Check aria-hidden="true" className="size-3" />
                          {t('bot.skillAlreadyInstalled')}
                        </>
                      ) : busyHere ? (
                        t('bot.skillInstalling')
                      ) : (
                        <>
                          <Download aria-hidden="true" className="size-3" />
                          {t('bot.skillInstallAction')}
                        </>
                      )}
                    </Button>
                  </div>
                );
              })}
            </Surface>
          )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
          <div className="flex items-center gap-2">
            {data.totalPages > 1 ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={state.loading || Boolean(installingId) || page <= 1}
                  onClick={() => {
                    void runSearch(query, page - 1);
                  }}
                >
                  {t('bot.skillHubPrev')}
                </Button>
                <span className="font-code text-caption text-muted-foreground">
                  {t('bot.skillHubPage', { page, total: data.totalPages })}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={state.loading || Boolean(installingId) || page >= data.totalPages}
                  onClick={() => {
                    void runSearch(query, page + 1);
                  }}
                >
                  {t('bot.skillHubNext')}
                </Button>
              </>
            ) : null}
          </div>
          <Button type="button" variant="outline" size="sm" disabled={Boolean(installingId)} onClick={onClose}>
            {t('settings.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
