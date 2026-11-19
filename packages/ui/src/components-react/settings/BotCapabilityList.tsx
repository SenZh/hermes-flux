import * as React from 'react';
import type { BotCapabilityList } from '@hermes-flux/core';
import { t, type I18nKey } from '../../i18n/index.js';
import { Switch } from '../primitives/Switch.js';

/**
 * BOT 能力清单（工具集 / 技能 / MCP）的逐项开关。
 *
 * 【设计意图 (Why)】三类能力在视觉与交互上是同一件事：一行一个条目、整行可点、
 *   行尾一个开关、非权威清单只读。把这一形态收敛成唯一实现后，BOT 面板只需提供
 *   "这一类的数据与文案键"，不可能出现三种不同的开关行。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 整行高亮但只有行尾能点（假可点）——这里用 label 关联 Switch，热区与高亮一致；
 *   2. 网关没返回清单时把"读取缺口"画成"全部关闭"——`authoritative === false` 时只读并显式提示；
 *   3. MCP 探活失败画成红灯——状态色调只有 success / muted，未知不冒充故障。
 *
 * 【约束与规则 (Rules)】
 *   1. 本组件不取数、不改草稿，所有值由调用方派生，所有写动作走 onToggle；
 *   2. 文案全部走 t()，颜色只用语义 Token；
 *   3. 行内不允许再加第二个开关或动作按钮。
 */

/** 能力清单的一行：整行可点（label 关联 Switch），名称 + 说明 + 开关。 */
function CapabilityRow({
  id,
  label,
  detail,
  checked,
  disabled,
  status,
  onToggle,
  toggleLabel,
}: {
  id: string;
  label: string;
  detail?: string;
  checked: boolean;
  disabled: boolean;
  status?: { text: string; tone: 'success' | 'muted' };
  onToggle: (next: boolean) => void;
  toggleLabel: string;
}): React.ReactElement {
  const switchId = `bot-capability-${id}`;
  return (
    // label 关联 Switch：整行可点符合触控直觉；行级 hover 与真实可点区域一致，
    // 不再是"整行高亮却只有行尾能点"的假可点。
    <label
      htmlFor={switchId}
      className={`-mx-2 flex cursor-pointer items-start justify-between gap-3 rounded-inner px-2 py-2 transition-colors hover:bg-card-hover ${
        disabled ? 'cursor-not-allowed opacity-60' : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-body text-foreground" title={label}>
            {label}
          </span>
          {status ? (
            <span
              className={`shrink-0 text-micro ${
                status.tone === 'success' ? 'text-success' : 'text-muted-foreground'
              }`}
            >
              {status.text}
            </span>
          ) : null}
        </div>
        {detail ? <p className="mt-1 break-words text-caption text-muted-foreground">{detail}</p> : null}
      </div>
      <Switch
        id={switchId}
        checked={checked}
        disabled={disabled}
        aria-label={toggleLabel}
        data-bot-capability={id}
        onCheckedChange={onToggle}
      />
    </label>
  );
}

/** 一类能力清单的完整区块：权威性提示 + 空态 + 逐项开关。 */
export function CapabilitySection({
  list,
  enabledIds,
  locked,
  toggleKey,
  renderDetail,
  onToggle,
  statusOf,
}: {
  list: BotCapabilityList;
  enabledIds: readonly string[];
  locked: boolean;
  /** 权威清单为空 → 「未配置任何条目」；非权威清单为空 → 「网关没返回该清单」。 */
  toggleKey: I18nKey;
  renderDetail?: (id: string) => string | undefined;
  onToggle: (id: string, next: boolean) => void;
  statusOf?: (id: string) => { text: string; tone: 'success' | 'muted' } | undefined;
}): React.ReactElement {
  const enabled = new Set(enabledIds);
  const listLocked = locked || !list.authoritative;
  if (list.rows.length === 0) {
    return (
      <div className="-mx-2 flex flex-col gap-1 px-2 py-2">
        {!list.authoritative ? <p className="text-caption text-warning">{t('bot.capabilityReadonly')}</p> : null}
        <p className="text-caption text-muted-foreground">
          {list.authoritative ? t('bot.capabilityNone') : t('bot.capabilityEmpty')}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {!list.authoritative ? (
        <p className="-mx-2 mb-1 px-2 text-caption text-warning">{t('bot.capabilityReadonly')}</p>
      ) : null}
      {list.rows.map((row) => (
        <CapabilityRow
          key={row.id}
          id={row.id}
          label={row.label}
          detail={renderDetail?.(row.id)}
          checked={enabled.has(row.id)}
          disabled={listLocked}
          status={statusOf?.(row.id)}
          toggleLabel={t(toggleKey, { name: row.label })}
          onToggle={(next) => onToggle(row.id, next)}
        />
      ))}
    </div>
  );
}
