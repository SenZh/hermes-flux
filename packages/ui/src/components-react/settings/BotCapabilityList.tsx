import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import type { BotCapabilityList, BotCapabilityRow } from '@hermes-flux/core';
import { t, type I18nKey } from '../../i18n/index.js';
import { Switch } from '../primitives/Switch.js';

/**
 * BOT 能力清单（工具集 / 技能 / MCP）的高密度可扩展开关矩阵。
 *
 * 【设计意图 (Why)】
 *   当工具或技能扩展到 200+ 项时，厚重边框卡片墙会产生严重视觉噪音与滚动疲惫。
 *   现采用轻量化无框双列微距行：默认与开启态均不画外框或染色框（开启/关闭由字重与
 *   对比度 + `<Switch>` 清晰区分，仅悬停轻浮起 `hover:bg-card-hover`）；左侧文字区走
 *   `<label htmlFor>` 保证点击即切换，右侧预留独立 `renderRowActions` 插槽以承载
 *   MCP 测试/删除等操作且不把按钮嵌套进 label。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 将 `<button>` 放进 `<label>` 内属于非法交互嵌套，点击按钮会误触发 Switch；
 *   2. 网关没返回清单时把"读取缺口"画成"全部关闭"——`authoritative === false` 时只读并显式提示；
 *   3. MCP 探活失败画成红灯——状态色调只有 success / muted，未知不冒充故障；
 *   4. 不同能力分组共享同一条目 id（如 `github`）时若不带分组前缀，DOM `id` 会冲突。
 *
 * 【约束与规则 (Rules)】
 *   1. 本组件不取数、不改草稿，所有值由调用方派生，所有写动作走 onToggle；
 *   2. 传入过滤后的 `visibleRows` 时，`enabledIds` 与 `list.authoritative` 仍保持权威口径；
 *   3. 文案全部走 t()，颜色只用语义 Token，间距只用 4px 网格整数倍。
 */

/** 单行高密度能力条目：左侧 label 触发开关，右侧承载扩展操作与 Switch。 */
function CapabilityRow({
  sectionId,
  id,
  label,
  detail,
  checked,
  disabled,
  status,
  actions,
  onInspect,
  inspectLabel,
  onToggle,
  toggleLabel,
}: {
  sectionId: string;
  id: string;
  label: string;
  detail?: string;
  checked: boolean;
  disabled: boolean;
  status?: { text: string; tone: 'success' | 'muted' };
  actions?: React.ReactNode;
  onInspect?: () => void;
  inspectLabel?: string;
  onToggle: (next: boolean) => void;
  toggleLabel: string;
}): React.ReactElement {
  const switchId = `bot-capability-${sectionId}-${id}`;
  const titleBody = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`truncate text-aux ${checked ? 'font-medium text-foreground' : 'font-normal text-secondary-foreground'}`}
        >
          {label}
        </span>
        {onInspect ? (
          <ChevronRight
            aria-hidden="true"
            className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-75"
          />
        ) : null}
        {status ? (
          <span
            className={`inline-flex shrink-0 items-center gap-1 text-micro ${
              status.tone === 'success' ? 'text-success' : 'text-muted-foreground'
            }`}
          >
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${
                status.tone === 'success' ? 'bg-success' : 'bg-muted-foreground'
              }`}
            />
            {status.text}
          </span>
        ) : null}
      </span>
      {detail ? <span className="mt-1 truncate text-caption text-muted-foreground">{detail}</span> : null}
    </>
  );

  return (
    <div
      data-bot-capability-row={id}
      className="group flex items-center justify-between gap-2 rounded-card px-3 py-2 transition-colors hover:bg-card-hover"
    >
      {onInspect ? (
        <button
          type="button"
          data-bot-capability-inspect={id}
          aria-label={inspectLabel}
          onClick={onInspect}
          className="flex min-h-7 min-w-0 flex-1 cursor-pointer flex-col justify-center rounded-inner text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {titleBody}
        </button>
      ) : (
        <label
          htmlFor={switchId}
          className={`flex min-w-0 flex-1 flex-col ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
        >
          {titleBody}
        </label>
      )}

      <div className="flex shrink-0 items-center gap-1">
        {actions}
        <Switch
          id={switchId}
          checked={checked}
          disabled={disabled}
          aria-label={toggleLabel}
          data-bot-capability={id}
          onCheckedChange={onToggle}
          className="shrink-0"
        />
      </div>
    </div>
  );
}

/** 一类能力清单的完整区块：权威性提示 + 空态 + 高密度响应式双列微距网格。 */
export function CapabilitySection({
  sectionId,
  list,
  visibleRows,
  enabledIds,
  locked,
  toggleKey,
  renderDetail,
  renderRowActions,
  onInspect,
  inspectLabelKey,
  onToggle,
  statusOf,
}: {
  /** 所属能力分组标识（toolsets / skills / mcp），防止跨分组同名 id 造成 DOM id 冲突。 */
  sectionId: string;
  list: BotCapabilityList;
  /** 可选：经过搜索与状态过滤后的展示子集（缺省展示全量）。 */
  visibleRows?: readonly BotCapabilityRow[];
  enabledIds: readonly string[];
  locked: boolean;
  /** 权威清单为空 → 「未配置任何条目」；非权威清单为空 → 「网关没返回该清单」。 */
  toggleKey: I18nKey;
  renderDetail?: (id: string) => string | undefined;
  renderRowActions?: (id: string) => React.ReactNode;
  /** 可选：点击条目左侧主体打开只读详情（例如 Skill Markdown 文档查看）；与 Switch 物理分离。 */
  onInspect?: (id: string) => void;
  inspectLabelKey?: I18nKey;
  onToggle: (id: string, next: boolean) => void;
  statusOf?: (id: string) => { text: string; tone: 'success' | 'muted' } | undefined;
}): React.ReactElement {
  const enabled = new Set(enabledIds);
  const listLocked = locked || !list.authoritative;
  const rowsToRender = visibleRows ?? list.rows;

  if (list.rows.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {!list.authoritative ? (
          <p className="rounded-card border border-warning/30 bg-panel px-3 py-2 text-caption text-warning">
            {t('bot.capabilityReadonly')}
          </p>
        ) : null}
        <p className="rounded-card border border-border-subtle bg-panel px-4 py-3 text-caption text-muted-foreground">
          {list.authoritative ? t('bot.capabilityNone') : t('bot.capabilityEmpty')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {!list.authoritative ? (
        <p className="mb-3 rounded-card border border-warning/30 bg-panel px-3 py-2 text-caption text-warning">
          {t('bot.capabilityReadonly')}
        </p>
      ) : null}
      {rowsToRender.length === 0 ? (
        <p className="py-8 text-center text-caption text-muted-foreground">{t('bot.capEmptyFiltered')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-x-4 gap-y-1 lg:grid-cols-2">
          {rowsToRender.map((row) => (
            <CapabilityRow
              key={row.id}
              sectionId={sectionId}
              id={row.id}
              label={row.label}
              detail={renderDetail?.(row.id)}
              checked={enabled.has(row.id)}
              disabled={listLocked}
              status={statusOf?.(row.id)}
              actions={renderRowActions?.(row.id)}
              onInspect={onInspect ? () => onInspect(row.id) : undefined}
              inspectLabel={
                onInspect && inspectLabelKey ? t(inspectLabelKey, { name: row.label }) : undefined
              }
              toggleLabel={t(toggleKey, { name: row.label })}
              onToggle={(next) => onToggle(row.id, next)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
