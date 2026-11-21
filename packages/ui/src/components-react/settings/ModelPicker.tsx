import * as React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { resolveProviderVendorId } from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import { describeModelVendorIcon, describeVendorIcon, type VendorIconDescriptor } from '../../lib/vendorIcon.js';
import { presentModel, type ModelPresentation } from '../../lib/modelPresentation.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../primitives/Menu.js';

/** 共享 `.vendor-icon` 五态 DOM 渲染内核，供模型维度与厂商维度共用，避免重复拼装。 */
function VendorIconView({
  icon,
  className = 'text-muted-foreground',
  suppressBadge = false,
}: {
  icon: VendorIconDescriptor;
  className?: string;
  suppressBadge?: boolean;
}): React.ReactElement | null {
  const classes = ['vendor-icon', className].filter(Boolean).join(' ');
  const boxStyle: React.CSSProperties = { width: icon.size, height: icon.size };
  const title = icon.label || undefined;

  if (icon.variant === 'badge') {
    if (suppressBadge) return null;
    return (
      <span className={`${classes} vendor-icon--badge`} style={boxStyle} title={title} aria-hidden="true">
        {icon.badgeLetter}
      </span>
    );
  }

  // SAFETY: CSS 自定义属性不在 React.CSSProperties 的类型面内；值来自已判定的厂商资产路径，
  // 不含用户输入，也不需要运行时转义。
  const monoSrc = { '--vendor-icon-src': `url('${icon.monoSrc}')` } as React.CSSProperties;
  const mono = <span className="vendor-icon__mono" style={monoSrc} />;
  const color = (
    <img
      className="vendor-icon__color"
      src={icon.colorSrc}
      alt=""
      width={icon.size}
      height={icon.size}
      draggable={false}
      decoding="async"
    />
  );

  if (icon.variant === 'mono') {
    return <span className={classes} style={boxStyle} title={title} aria-hidden="true">{mono}</span>;
  }
  if (icon.variant === 'color') {
    return <span className={classes} style={boxStyle} title={title} aria-hidden="true">{color}</span>;
  }
  const dualClass = icon.variant === 'dual-inverse' ? 'vendor-icon--dual vendor-icon--dual-inverse' : 'vendor-icon--dual';
  return (
    <span className={`${classes} ${dualClass}`} style={boxStyle} title={title} aria-hidden="true">
      {color}
      {mono}
    </span>
  );
}

/**
 * 模型厂商图标（React 版）。
 *
 * 【设计意图 (Why)】
 *   与输入舱模型切换器必须是**同一个图标**：设置页曾经用 lucide 通用描边图形
 *   （Anthropic = 大脑、OpenAI = 闪电）冒充品牌，用户认不出是哪家。现在两条渲染路径
 *   共用 `describeModelVendorIcon` 的判定与 lobe 品牌资产，只差一层 DOM 表达。
 *
 * 【约束与规则 (Rules)】
 *   1. 资产路径相对渲染产物根目录（desktop 构建会把 `icons/lobe` 拷进 dist/renderer）；
 *   2. 判不出厂商时渲染首字母 badge，绝不返回 null 让行首塌陷；
 *   3. 图形只做装饰，`aria-hidden`；可读名由相邻文本承担，`title` 只放厂商展示名。
 */
export function ModelVendorIcon({
  modelId,
  providerName = '',
  // 与输入舱模型列表行同档 14px（触发按钮是 16px）；行内图标必须比模型名退后一层。
  size = 14,
  className = 'text-muted-foreground',
}: {
  modelId: string;
  providerName?: string;
  size?: number;
  className?: string;
}): React.ReactElement {
  const icon = describeModelVendorIcon(modelId, providerName, { size });
  return <VendorIconView icon={icon} className={className} /> as React.ReactElement;
}

/**
 * 提供商/厂商维度图标（React 版，对齐 InputDock 分组标题的厂商识别规范）。
 */
export function ProviderVendorIcon({
  providerSlug,
  providerName = '',
  size = 14,
  className = 'text-muted-foreground',
  suppressBadge = false,
}: {
  providerSlug: string;
  providerName?: string;
  size?: number;
  className?: string;
  suppressBadge?: boolean;
}): React.ReactElement | null {
  const vendorId = resolveProviderVendorId(providerSlug, providerName);
  const icon = describeVendorIcon({
    vendorId,
    label: providerName || providerSlug,
    size,
  });
  return <VendorIconView icon={icon} className={className} suppressBadge={suppressBadge} />;
}

/**
 * 一行模型：图标 + 计算后的完整可读名。
 *
 * 【设计意图 (Why)】
 *   模型选择器、查看模型弹框、端点编辑下拉共用这一行，名字与图形的解析只做一次。
 *   裸 ID 永远不出现在可见文本里，只在写回时使用。
 *
 * 【规则】不再额外渲染变体/量化/上下文标签：`name` 已经把 ID 里的尾部标签全部拼回，
 *   再挂一枚 `Fast` 会出现 `Opus 4.8 Fast Fast` 的重复。标签只作为名字的视觉强调时
 *   才有意义，而这里没有独立的强调位，所以只保留一份完整名字。
 */
export function ModelOptionRow({
  modelId,
  providerName,
  current,
  selected,
}: {
  modelId: string;
  providerName: string;
  current?: boolean;
  selected?: boolean;
}): React.ReactElement {
  const view: ModelPresentation = presentModel(modelId, providerName);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <ModelVendorIcon modelId={modelId} providerName={providerName} />
      <span className="min-w-0 flex-1 truncate text-caption text-foreground">{view.name}</span>
      {current ? <span className="shrink-0 text-micro text-success">{t('settings.providerCurrent')}</span> : null}
      {selected ? <Check aria-hidden="true" className="size-3 shrink-0 text-primary" strokeWidth={2.5} /> : null}
    </span>
  );
}

/**
 * 端点表单的默认模型选择器（可输入 + 可下拉）。
 *
 * 【设计意图 (Why)】
 *   用户要求"点击后有下拉框，从可用模型里选"，但端点第一次创建时模型列表可能还没探测出来，
 *   所以不能把输入能力砍掉：选择器与手输必须共存。
 *
 * 【防范的历史坑】
 *   裸 `<select>` 无法显示图标与计算后的名称，只能把 ID 原样铺出来；
 *   完全只读的按钮又会让"还没探测模型"的新端点无法创建。
 *
 * 【约束与规则 (Rules)】
 *   1. 有模型列表时默认展示选择器；切到"手动输入"后保留原始 ID 编辑能力；
 *   2. 下拉项一律走 `ModelOptionRow`，禁止直接渲染 ID；
 *   3. 没有模型列表时退化为普通输入框，不渲染空下拉。
 */
export function ModelPickerField({
  value,
  models,
  providerName,
  placeholder,
  ariaLabel,
  onChange,
}: {
  value: string;
  models: readonly string[];
  providerName: string;
  placeholder?: string;
  ariaLabel: string;
  onChange: (model: string) => void;
}): React.ReactElement {
  const [manual, setManual] = React.useState(false);
  const hasModels = models.length > 0;
  const selected = value ? presentModel(value, providerName) : null;

  if (!hasModels) {
    return (
      <div className="flex flex-col gap-1">
        <Input
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          onChange={(event) => onChange(event.target.value)}
          size="sm"
          className="font-code"
        />
        <p className="text-micro text-muted-foreground">{t('settings.providerModelListHint')}</p>
      </div>
    );
  }

  if (manual) {
    return (
      <div className="flex items-center gap-2">
        <Input
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoFocus
          onChange={(event) => onChange(event.target.value)}
          size="sm"
          className="flex-1 font-code"
        />
        <Button
          variant="outline"
          size="sm"
          type="button"
          className="shrink-0 whitespace-nowrap"
          onClick={() => setManual(false)}
        >
          {t('settings.providerModelFromList')}
        </Button>
      </div>
    );
  }

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="flex h-8 w-full items-center gap-2 rounded-card border border-border bg-input px-3 text-left text-body text-foreground transition-colors hover:bg-card-hover"
        >
          {selected ? (
            <>
              <ModelVendorIcon modelId={value} providerName={providerName} />
              <span className="min-w-0 flex-1 truncate text-caption text-foreground">{selected.name}</span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
              {placeholder || t('settings.providerModelPick')}
            </span>
          )}
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </MenuTrigger>
      {/* 下拉经 Radix Portal 挂到 body，用语义档位 z-menu 高于设置弹窗宿主 */}
      <MenuContent className="z-menu w-80 p-1" align="start">
        <div className="max-h-64 overflow-y-auto">
          {models.map((model) => (
            <MenuItem
              key={model}
              className="flex items-center gap-2"
              onSelect={() => onChange(model)}
            >
              <ModelOptionRow modelId={model} providerName={providerName} selected={model === value} />
            </MenuItem>
          ))}
        </div>
        <div className="my-1 h-px bg-border-subtle" role="separator" />
        <MenuItem className="text-caption text-muted-foreground" onSelect={() => setManual(true)}>
          {t('settings.providerModelManual')}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/**
 * 点一个模型后的弹框状态转移。
 *
 * 【为什么要抽成纯函数】`confirmRequired` 保窗、失败保窗、成功关闭是三条互斥分支，
 *   以前只能靠浏览器手点验证。抽出来后可以用单测穷举，组件只负责把结果映射到 state。
 */
export type ModelPickOutcome =
  | { close: true }
  | { close: false; warning: string; error: ''; pendingModel: string }
  | { close: false; warning: ''; error: string; pendingModel: string };

export function resolveModelPick(
  result: { ok: boolean; confirmRequired?: boolean; message?: string },
  model: string,
  fallback: { expensive: string; failed: string },
): ModelPickOutcome {
  if (result.confirmRequired) {
    return { close: false, warning: result.message || fallback.expensive, error: '', pendingModel: model };
  }
  if (!result.ok) {
    return { close: false, warning: '', error: result.message || fallback.failed, pendingModel: model };
  }
  return { close: true };
}

/**
 * 「查看模型」弹框。
 *
 * 【设计意图 (Why)】
 *   模型列表直接铺在行里会把整张提供商表撑成大列表，用户还得在行与行之间找。
 *   弹框把"看模型 + 设为当前模型"收敛到一个有边界的作用域里，行本身只留一个入口。
 *
 * 【约束与规则 (Rules)】
 *   1. 点击模型即尝试设为当前模型；网关要求高价确认时弹窗不关，显示原文与「仍然设置」；
 *   2. 当前模型必须标注，不能让用户靠猜；
 *   3. 失败保留弹窗并显示原因（No Empty Failure）。
 */
export function ModelPickerDialog({
  open,
  onClose,
  title,
  subtitle,
  providerName,
  models,
  currentModel,
  busy = false,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  providerName: string;
  models: readonly string[];
  currentModel?: string;
  busy?: boolean;
  onPick: (model: string, confirmExpensive: boolean) => Promise<{
    ok: boolean;
    confirmRequired?: boolean;
    message?: string;
  }>;
}): React.ReactElement | null {
  const [pendingModel, setPendingModel] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [warning, setWarning] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (open) return;
    setPendingModel('');
    setPending(false);
    setWarning('');
    setError('');
  }, [open]);

  if (!open) return null;

  const pick = async (model: string, confirmExpensive: boolean): Promise<void> => {
    setPending(true);
    setPendingModel(model);
    setError('');
    const result = await onPick(model, confirmExpensive);
    setPending(false);
    const next = resolveModelPick(result, model, {
      expensive: t('settings.providerExpensiveWarning'),
      failed: t('settings.providerToggleFailed'),
    });
    if (next.close) {
      onClose();
      return;
    }
    setWarning(next.warning);
    setError(next.error);
  };

  const confirmPending = warning && pendingModel;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        portal={false}
        className="flex max-h-modal-sm w-full max-w-lg flex-col gap-0 overflow-hidden rounded-window p-0"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="min-w-0">
            <DialogTitle className="truncate text-section font-medium text-foreground">{title}</DialogTitle>
            <DialogDescription className="mt-1 text-caption text-muted-foreground">{subtitle}</DialogDescription>
          </div>
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>
            {t('settings.close')}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {models.length === 0 ? (
            <p className="px-2 py-6 text-center text-caption text-muted-foreground">
              {t('settings.providerNoModels')}
            </p>
          ) : (
            models.map((model) => (
              <button
                key={model}
                type="button"
                disabled={busy || pending}
                data-model-id={model}
                onClick={() => { void pick(model, false); }}
                className="flex w-full items-center gap-2 rounded-inner px-2 py-2 text-left transition-colors hover:bg-card-hover disabled:opacity-60"
              >
                <ModelOptionRow
                  modelId={model}
                  providerName={providerName}
                  current={currentModel === model}
                  selected={pendingModel === model && pending}
                />
              </button>
            ))
          )}
        </div>

        {warning ? (
          <p className="border-t border-border-subtle px-4 py-2 text-caption text-warning" role="alert">
            {warning}
          </p>
        ) : null}
        {error ? (
          <p className="border-t border-border-subtle px-4 py-2 text-caption text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {confirmPending ? (
          <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
            <Button
              size="sm"
              type="button"
              disabled={busy || pending}
              onClick={() => { void pick(pendingModel, true); }}
            >
              {t('settings.providerUseAnyway')}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export interface GroupedModelOptionGroup {
  id: string;
  name: string;
  models: ReadonlyArray<{ id: string; name: string }>;
}

export interface GroupedModelSelectProps {
  id?: string;
  value: string;
  provider?: string;
  groups: readonly GroupedModelOptionGroup[];
  currentModelOffline?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  labels: {
    unbound: string;
    offline: string;
    catalogUnavailable: string;
    searchPlaceholder: string;
    emptySearch: string;
  };
  onChange: (modelId: string, providerId: string) => void;
}

/**
 * 对齐 InputDock 质感的分组模型选择器（同时展示模型图标与提供商/厂商图标）。
 *
 * 【设计意图 (Why)】
 *   通用 `<Select>` 只有窄面板与纯文字分组头，在 BOT 配置中枢承担“主推理模型”核心绑定时
 *   既放不下长模型名、也看不清代理接入方与模型原生厂商的区别。这里复刻 InputDock
 *   的模型手风琴语言：触发器同时显示「模型图标 + 可读名」与右侧「厂商图标胶囊」，
 *   展开浮层带即时搜索、可折叠提供商标题行与独立滚轮条。
 */
export function GroupedModelSelect({
  id,
  value,
  provider,
  groups,
  currentModelOffline = false,
  disabled = false,
  ariaLabel,
  labels,
  onChange,
}: GroupedModelSelectProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const [coords, setCoords] = React.useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const activeGroup = React.useMemo(() => {
    if (!value) return undefined;
    if (provider) {
      const exact = groups.find(
        (group) => group.id === provider && group.models.some((item) => item.id === value),
      );
      if (exact) return exact;
    }
    return groups.find((group) => group.models.some((item) => item.id === value));
  }, [groups, value, provider]);

  const activeProviderId = activeGroup?.id || provider || '';
  const activeProviderName = activeGroup?.name || provider || '';
  const selectedLabel = React.useMemo(() => {
    if (!value) return '';
    return presentModel(value, activeProviderName).name || value;
  }, [value, activeProviderName]);

  const closeMenu = React.useCallback((returnFocus = false) => {
    setOpen(false);
    setQuery('');
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const updateCoords = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === 'undefined') return;
    const rect = trigger.getBoundingClientRect();
    const hostEl = trigger.closest('.flux-settings') as HTMLElement | null;
    const hostRect = hostEl ? hostEl.getBoundingClientRect() : null;
    const boundLeft = hostRect ? hostRect.left + 12 : 12;
    const boundRight = hostRect ? hostRect.right - 12 : window.innerWidth - 12;
    const boundTop = hostRect ? hostRect.top + 12 : 12;
    const boundBottom = hostRect ? hostRect.bottom - 12 : window.innerHeight - 12;
    const width = Math.min(Math.max(rect.width, 384), Math.max(240, boundRight - boundLeft));
    const vpLeft = Math.min(Math.max(boundLeft, rect.left), Math.max(boundLeft, boundRight - width));
    // `.flux-settings`（DialogContent）自带 translate(-50%,-50%) 与 overflow-hidden，
    // 会成为内部 position:fixed 浮层的包含块；必须换算为相对 hostRect 的偏移量，否则会偏出右边界并在聚焦时引发整窗横向滚动。
    const left = hostRect ? vpLeft - hostRect.left : vpLeft;
    const spaceBelow = boundBottom - rect.bottom;
    const spaceAbove = rect.top - boundTop;
    if (spaceBelow < 300 && spaceAbove > spaceBelow) {
      const bottomBase = hostRect ? hostRect.bottom : window.innerHeight;
      setCoords({ left, width, bottom: Math.max(12, bottomBase - rect.top + 4) });
    } else {
      const topBase = hostRect ? hostRect.top : 0;
      setCoords({ left, width, top: rect.bottom - topBase + 4 });
    }
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
    window.requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      closeMenu(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    };
    const handleScroll = (event: Event): void => {
      const target = event.target as Node | null;
      if (target && popoverRef.current?.contains(target)) return;
      updateCoords();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    window.addEventListener('resize', updateCoords);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', updateCoords);
    };
  }, [open, updateCoords, closeMenu]);

  const needle = query.trim().toLowerCase();
  const hasQuery = needle.length > 0;
  const filteredGroups = React.useMemo(() => {
    if (!hasQuery) return groups;
    return groups
      .map((group) => {
        const providerMatch =
          group.id.toLowerCase().includes(needle) || group.name.toLowerCase().includes(needle);
        const matchingModels = providerMatch
          ? group.models
          : group.models.filter((item) => {
              const readable = presentModel(item.id, group.name).name.toLowerCase();
              return (
                item.id.toLowerCase().includes(needle) ||
                item.name.toLowerCase().includes(needle) ||
                readable.includes(needle)
              );
            });
        return { ...group, models: matchingModels };
      })
      .filter((group) => group.models.length > 0);
  }, [groups, hasQuery, needle]);

  const toggleGroup = (groupId: string): void => {
    setCollapsed((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const portalHost =
    typeof document !== 'undefined'
      ? (triggerRef.current?.closest('.flux-settings') as HTMLElement | null) ?? document.body
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          if (open) closeMenu(false);
          else setOpen(true);
        }}
        className="flex h-9 w-full items-center gap-2 rounded-card border border-border bg-input px-3 text-left text-body text-foreground transition-colors hover:border-border-strong hover:bg-card-hover focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        {groups.length === 0 ? (
          <span className="min-w-0 flex-1 truncate text-body text-muted-foreground">
            {labels.catalogUnavailable}
          </span>
        ) : !value ? (
          <span className="min-w-0 flex-1 truncate text-body text-muted-foreground">{labels.unbound}</span>
        ) : currentModelOffline ? (
          <>
            <ModelVendorIcon modelId={value} providerName={activeProviderName} size={16} />
            <span className="min-w-0 flex-1 truncate text-body text-warning">{labels.offline}</span>
          </>
        ) : (
          <>
            <ModelVendorIcon modelId={value} providerName={activeProviderName} size={16} />
            <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
              {selectedLabel}
            </span>
            {activeProviderName ? (
              <span
                data-model-trigger-vendor="true"
                className="inline-flex h-6 max-w-36 shrink-0 items-center gap-1 rounded-inner border border-border-subtle bg-secondary px-2 text-caption text-muted-foreground"
              >
                <ProviderVendorIcon
                  providerSlug={activeProviderId}
                  providerName={activeProviderName}
                  size={12}
                />
                <span className="truncate">{activeProviderName}</span>
              </span>
            ) : null}
          </>
        )}
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open && portalHost && coords
        ? createPortal(
            <div
              ref={popoverRef}
              data-grouped-model-popover="true"
              style={{
                position: 'fixed',
                left: coords.left,
                width: coords.width,
                ...(coords.top !== undefined ? { top: coords.top } : {}),
                ...(coords.bottom !== undefined ? { bottom: coords.bottom } : {}),
              }}
              className="z-menu flex flex-col overflow-hidden rounded-panel border border-border bg-popover shadow-window"
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-panel px-3 py-2">
                <div className="relative min-w-0 flex-1">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    ref={searchRef}
                    size="sm"
                    value={query}
                    data-grouped-model-search="true"
                    placeholder={labels.searchPlaceholder}
                    aria-label={labels.searchPlaceholder}
                    onChange={(event) => setQuery(event.target.value)}
                    className="pl-8 pr-7"
                  />
                  {query ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('settings.close')}
                      onClick={() => setQuery('')}
                      className="absolute right-1 top-1/2 -translate-y-1/2"
                    >
                      <X aria-hidden="true" className="size-3" />
                    </Button>
                  ) : null}
                </div>
              </div>

              <div
                role="listbox"
                aria-label={ariaLabel}
                className="scrollbar-thin max-h-80 overflow-y-auto p-2"
              >
                {currentModelOffline && value ? (
                  <div className="mb-2 flex items-center gap-2 rounded-card border border-warning/30 bg-panel px-2 py-2 text-caption text-warning">
                    <ModelVendorIcon modelId={value} providerName={activeProviderName} size={14} />
                    <span className="truncate">{labels.offline}</span>
                  </div>
                ) : null}

                {filteredGroups.length === 0 ? (
                  <p className="px-3 py-6 text-center text-caption text-muted-foreground">
                    {labels.emptySearch}
                  </p>
                ) : (
                  filteredGroups.map((group, groupIndex) => {
                    const isCollapsed = !hasQuery && Boolean(collapsed[group.id]);
                    return (
                      <div
                        key={group.id}
                        className={groupIndex > 0 ? 'mt-2 border-t border-border-subtle pt-2' : ''}
                      >
                        <button
                          type="button"
                          data-model-group={group.id}
                          aria-expanded={!isCollapsed}
                          disabled={hasQuery}
                          onClick={() => toggleGroup(group.id)}
                          className="flex min-h-7 w-full items-center justify-between gap-2 rounded-card px-2 py-1 text-left transition-colors hover:bg-card-hover disabled:cursor-default disabled:hover:bg-transparent"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <ProviderVendorIcon
                              providerSlug={group.id}
                              providerName={group.name}
                              size={14}
                            />
                            <span className="truncate text-caption font-medium text-secondary-foreground">
                              {group.name}
                            </span>
                            <span className="font-code text-micro text-muted-foreground tabular-nums">
                              ({group.models.length})
                            </span>
                          </span>
                          {!hasQuery ? (
                            isCollapsed ? (
                              <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronDown aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
                            )
                          ) : null}
                        </button>

                        {!isCollapsed ? (
                          <div className="mt-1 flex flex-col gap-1">
                            {group.models.map((model) => {
                              const view = presentModel(model.id, group.name);
                              const isSelected =
                                model.id === value &&
                                (provider ? group.id === provider : activeGroup?.id === group.id);
                              return (
                                <button
                                  key={`${group.id}:${model.id}`}
                                  type="button"
                                  role="option"
                                  aria-selected={isSelected}
                                  data-model-option={model.id}
                                  onClick={() => {
                                    onChange(model.id, group.id);
                                    closeMenu(true);
                                  }}
                                  className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-card px-2 py-2 text-left transition-colors ${
                                    isSelected
                                      ? 'bg-card-active font-medium text-foreground'
                                      : 'text-foreground hover:bg-card-hover'
                                  }`}
                                >
                                  <span className="flex min-w-0 flex-1 items-center gap-2">
                                    <ModelVendorIcon
                                      modelId={model.id}
                                      providerName={group.name}
                                      size={16}
                                    />
                                    <span className="min-w-0 flex-1 truncate text-body">{view.name}</span>
                                  </span>
                                  {isSelected ? (
                                    <Check
                                      aria-hidden="true"
                                      className="size-4 shrink-0 text-foreground"
                                      strokeWidth={2}
                                    />
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>,
            portalHost,
          )
        : null}
    </>
  );
}
