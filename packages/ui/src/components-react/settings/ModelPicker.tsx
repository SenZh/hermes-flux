import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { t } from '../../i18n/index.js';
import { describeModelVendorIcon } from '../../lib/vendorIcon.js';
import { presentModel, type ModelPresentation } from '../../lib/modelPresentation.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../primitives/Menu.js';

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
  const classes = ['vendor-icon', className].filter(Boolean).join(' ');
  const boxStyle: React.CSSProperties = { width: icon.size, height: icon.size };
  const title = icon.label || undefined;

  if (icon.variant === 'badge') {
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
          className="h-8 font-code text-caption"
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
          className="h-8 flex-1 font-code text-caption"
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
          className="flex h-8 w-full items-center gap-2 rounded-inner border border-border bg-input px-2 text-left transition-colors hover:bg-card-hover"
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
      {/* gate-theme-allow: 设置中心整体是 z-[1000]，下拉经 Radix Portal 挂到 body，必须抬到它之上 */}
      <MenuContent className="z-[1200] w-80 p-1" align="start">
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
  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) {
      setPendingModel('');
      setPending(false);
      setWarning('');
      setError('');
      return;
    }
    // 弹框打开后必须把焦点收进来：否则 Esc 的事件源仍在行内按钮上，
    // 会冒泡到设置中心的 window 监听，一次 Esc 直接把整个设置页关掉。
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => { previous?.focus?.(); };
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
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-backdrop/60 p-4"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      onKeyDown={(event) => {
        // 焦点已收进弹框；这里只关当前这一层，不再冒泡到设置中心的 window 监听。
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      aria-label={title}
    >
      {/* gate-theme-allow: 模型多时必须相对视口有界并内部滚动 */}
      <div className="flex max-h-[min(560px,calc(100vh-96px))] w-full max-w-lg flex-col overflow-hidden rounded-window border border-border bg-popover shadow-window">
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-section font-medium text-foreground">{title}</h3>
            <p className="mt-1 text-caption text-muted-foreground">{subtitle}</p>
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
      </div>
    </div>
  );
}
