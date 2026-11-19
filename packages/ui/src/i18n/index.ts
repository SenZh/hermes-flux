/**
 * Hermes Flux Standardized i18n Architecture (OpenChamber Parity)
 * Flat key dictionary with compile-time parity validation.
 *
 * 设计意图 (Why)：词条按功能域拆入 ./messages/*，本文件只做合并、类型收口与查表。
 * 约束与规则 (Rules)：
 *   1. messages/* 片段禁止任何类型注解，否则该域 key 会从 I18nKey 中消失（TS2345/TS2344）；
 *   2. enDict 保留 Record<I18nKey, string> 注解，缺 key 会在编译期报 TS2741；
 *   3. 下方 Locale / DICTIONARIES / setLocale / getLocale / t 必须逐字节保持原样（含空行位置）：
 *      增量覆盖率门禁已锁定它们的未覆盖分支，任何格式化改写都会把未覆盖行拖进 diff。
 */

import { zhChrome, enChrome } from './messages/chrome.js';
import { zhSettings, enSettings } from './messages/settings.js';
import { zhSlash, enSlash } from './messages/slash.js';
import { zhBot, enBot } from './messages/bot.js';
import { zhConversation, enConversation } from './messages/conversation.js';
import { zhDock, enDock } from './messages/dock.js';
import { zhInspector, enInspector } from './messages/inspector.js';
import { zhAgents, enAgents } from './messages/agents.js';
import { zhGallery, enGallery } from './messages/gallery.js';

export const zhDict = {
  ...zhChrome,
  ...zhSettings,
  ...zhSlash,
  ...zhBot,
  ...zhConversation,
  ...zhDock,
  ...zhInspector,
  ...zhAgents,
  ...zhGallery,
} as const;

export type I18nKey = keyof typeof zhDict;

export const enDict: Record<I18nKey, string> = {
  ...enChrome,
  ...enSettings,
  ...enSlash,
  ...enBot,
  ...enConversation,
  ...enDock,
  ...enInspector,
  ...enAgents,
  ...enGallery,
};
export type Locale = 'zh-CN' | 'en-US';
export const DICTIONARIES: Record<Locale, Record<I18nKey, string>> = {
  'zh-CN': zhDict,
  'en-US': enDict,
};
let currentLocale: Locale = 'zh-CN';
export function setLocale(locale: Locale): void {
  currentLocale = locale;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}
export function getLocale(): Locale {
  return currentLocale;
}
export function t(key: I18nKey, params?: Record<string, string | number>): string {
  const dict = DICTIONARIES[currentLocale] || zhDict;
  let text: string = dict[key] ?? zhDict[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}
