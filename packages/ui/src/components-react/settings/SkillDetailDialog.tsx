import * as React from 'react';
import { BookOpen, Copy, RotateCcw, X } from 'lucide-react';
import { splitSkillMarkdownFrontmatter, type SkillInspectView } from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import { MarkdownBlock } from '../conversation/MarkdownBlock.js';
import { Badge } from '../primitives/Badge.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../primitives/Dialog.js';
import { Skeleton } from '../primitives/Skeleton.js';
import { SegmentedControl } from './SegmentedControl.js';
import type { SettingsActions } from './settingsModel.js';

/**
 * 技能完整说明与源码查看弹窗（格式化后优雅预览 / 格式化前原始源码切换）。
 *
 * 【设计意图 (Why)】
 *   Skill 文件本身是以 Markdown（含可选 YAML frontmatter）编写的能力规范。
 *   列表行只承载名称与一行简介，点击条目时在二级模态窗口中按双视图呈现：
 *   1. 「优雅预览」剥离顶层 frontmatter 元数据单独排版，正文复用全站唯一的
 *      `MarkdownBlock`（自带代码高亮与一键复制）；
 *   2. 「原始源码」保留未经解析的 `SKILL.md` 原文（含 frontmatter），方便审校与复制。
 *
 * 【约束与规则 (Rules)】
 *   1. 使用 `Dialog` 原语 + `portal={false}` + `max-h-modal-md` + `shrink-0` 滚动保护；
 *   2. 异步 inspect 内建自增序列令牌与 `try/catch/finally`，切技能或重试绝不串台或卡死；
 *   3. 所有文案走 `t()`，严禁硬编码实体称谓与原生调色板类名。
 */

export type SkillMarkdownViewMode = 'rendered' | 'raw';

export interface SkillDetailDialogProps {
  skillName: string | null;
  targetProfile: string;
  fallbackDescription?: string;
  onClose: () => void;
  onInspectSkill?: SettingsActions['onInspectSkill'];
  onCopy?: SettingsActions['onCopy'];
  onNotify?: SettingsActions['onNotify'];
}

export function SkillDetailDialog({
  skillName,
  targetProfile,
  fallbackDescription,
  onClose,
  onInspectSkill,
  onCopy,
  onNotify,
}: SkillDetailDialogProps): React.ReactElement | null {
  const [viewMode, setViewMode] = React.useState<SkillMarkdownViewMode>('rendered');
  const [state, setState] = React.useState<{
    loading: boolean;
    data?: SkillInspectView;
    error?: string;
  }>({ loading: false });
  const seqRef = React.useRef(0);

  const loadSkill = React.useCallback(async () => {
    if (!skillName || !onInspectSkill) return;
    const seq = ++seqRef.current;
    setState({ loading: true });
    try {
      const result = await onInspectSkill(targetProfile, skillName, fallbackDescription);
      if (seq !== seqRef.current) return;
      if (!result.ok || !result.data) {
        setState({ loading: false, error: result.message || t('settings.loadFailed') });
        return;
      }
      setState({ loading: false, data: result.data });
    } catch (error) {
      if (seq !== seqRef.current) return;
      setState({
        loading: false,
        error: error instanceof Error && error.message ? error.message : t('settings.loadFailed'),
      });
    }
  }, [skillName, targetProfile, fallbackDescription, onInspectSkill]);

  React.useEffect(() => {
    if (!skillName) {
      seqRef.current += 1;
      setState({ loading: false });
      return;
    }
    setViewMode('rendered');
    void loadSkill();
  }, [skillName, loadSkill]);

  const data = state.data;
  const markdown = data?.markdown ?? '';
  const parsed = React.useMemo(() => splitSkillMarkdownFrontmatter(markdown), [markdown]);

  if (!skillName) return null;

  const description = data?.description || fallbackDescription || '';

  const handleCopyMarkdown = async (): Promise<void> => {
    if (!markdown || !onCopy) return;
    const ok = await onCopy(markdown);
    if (ok) onNotify?.(t('bot.copied'));
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        portal={false}
        data-skill-detail-dialog="true"
        className="flex max-h-modal-md w-full max-w-2xl flex-col gap-0 overflow-hidden rounded-window p-0"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-card border border-border-subtle bg-panel text-muted-foreground"
            >
              <BookOpen aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="truncate text-section font-semibold text-foreground">
                  {data?.name || skillName}
                </DialogTitle>
                {data?.source ? (
                  <Badge variant="secondary">{`${t('bot.skillMetaSource')}: ${data.source}`}</Badge>
                ) : null}
                {data?.category ? <Badge variant="secondary">{data.category}</Badge> : null}
                {data?.isPreview ? <Badge variant="secondary">{t('bot.skillInspectPreviewBadge')}</Badge> : null}
                {data?.tags?.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
              <DialogDescription className="mt-1 text-caption text-muted-foreground">
                {description || skillName}
              </DialogDescription>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('settings.close')}
            onClick={onClose}
            className="shrink-0"
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-panel px-5 py-2">
          <SegmentedControl
            value={viewMode}
            options={[
              { value: 'rendered', label: t('bot.skillViewRendered') },
              { value: 'raw', label: t('bot.skillViewRaw') },
            ]}
            ariaLabel={t('bot.skillViewModeAria')}
            onChange={setViewMode}
          />
          {onCopy ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={!markdown || state.loading}
              onClick={() => {
                void handleCopyMarkdown();
              }}
              className="shrink-0"
            >
              <Copy aria-hidden="true" className="size-3" />
              <span>{t('bot.skillCopyMarkdown')}</span>
            </Button>
          ) : null}
        </div>

        <div
          data-skill-detail-scroll="true"
          className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          {state.loading ? (
            <div className="flex flex-col gap-3" role="status" aria-label={t('bot.skillInspectLoading')}>
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-24 w-full" />
              <p className="text-caption text-muted-foreground">{t('bot.skillInspectLoading')}</p>
            </div>
          ) : state.error ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-destructive/30 bg-panel px-4 py-3 text-caption text-destructive"
            >
              <span>{state.error}</span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => {
                  void loadSkill();
                }}
                className="shrink-0"
              >
                <RotateCcw aria-hidden="true" className="size-3" />
                <span>{t('bot.retry')}</span>
              </Button>
            </div>
          ) : !markdown ? (
            <p className="rounded-card border border-border-subtle bg-panel px-4 py-6 text-center text-caption text-muted-foreground">
              {t('bot.skillInspectEmpty')}
            </p>
          ) : viewMode === 'raw' ? (
            <pre
              data-skill-markdown-raw="true"
              className="m-0 overflow-x-auto whitespace-pre-wrap break-words rounded-card border border-border-subtle bg-code p-4 font-code text-aux leading-normal text-foreground"
            >
              {markdown}
            </pre>
          ) : (
            <div data-skill-markdown-rendered="true" className="flex flex-col gap-4">
              {parsed.frontmatter.length > 0 ? (
                <div className="flex shrink-0 flex-col gap-1 rounded-card border border-border-subtle bg-panel px-3 py-2">
                  {parsed.frontmatter.map((entry) => (
                    <div key={entry.key} className="flex items-baseline gap-3 text-caption">
                      <span className="shrink-0 font-code text-muted-foreground">{entry.key}</span>
                      <span className="min-w-0 flex-1 break-words text-foreground">{entry.value}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {parsed.body.trim() ? <MarkdownBlock content={parsed.body} className="text-body" /> : null}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
