/**
 * 斜杠命令目录的纯投影层。
 *
 * 【设计意图 (Why)】
 *   网关 `complete.slash` / `commands.catalog` 返回的说明是英文原文，
 *   而命令名是技术标识必须保留原文。这层只做「名称原样、说明本地化」的投影，
 *   纯函数、零副作用，因此可以脱离宿主单测，不必去驱动整个渲染进程。
 *
 * 【约束与规则 (Rules)】
 *   1. 字典只覆盖已确认存在的命令；未收录的回退网关原文，绝不编造说明；
 *   2. 条数由网关决定，本层不得截断（历史实现写死 12 条，宽前缀下后半段永远不可见）。
 */

import type { I18nKey } from '@hermes-flux/ui';

/** 本地化结果：命令名保持原文，说明取字典命中值或网关原文。 */
export interface SlashOption {
  name: string;
  description: string;
  isSkill?: boolean;
  replaceFrom?: number;
}

/**
 * 说明本地化。
 *
 * 【规则】`t()` 对缺失键原样返回键名，据此判定是否命中字典，
 *   从而在「字典有翻译」与「网关原文」之间做唯一裁决。
 */
export function localizeSlashDescription(
  name: string,
  fallback: string,
  translate: (key: I18nKey) => string,
): string {
  const bare = name.replace(/^\//, '').trim();
  if (!bare) return fallback;
  const key = `slash.${bare}` as I18nKey;
  const translated = translate(key);
  return translated === key ? fallback : translated;
}

/**
 * 把网关补全项投影成浮层条目。
 *
 * 【规则】`replaceFrom` 只在命令项上携带：技能项没有可替换的光标 token。
 */
export function toSlashOptions(
  items: ReadonlyArray<{ text?: string; meta?: string; display?: string; kind?: string | null }>,
  replaceFrom: number | undefined,
  translate: (key: I18nKey) => string,
): SlashOption[] {
  const out: SlashOption[] = [];
  for (const it of items) {
    const raw = it.text || '';
    if (!raw.trim()) continue;
    const name = raw.startsWith('/') ? raw : `/${raw}`;
    out.push({
      name,
      description: localizeSlashDescription(name, it.meta || it.display || '', translate),
      isSkill: it.kind === 'skill',
      replaceFrom: it.kind ? replaceFrom : undefined,
    });
  }
  return out;
}
