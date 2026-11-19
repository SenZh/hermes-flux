/**
 * i18n 编译期类型棘轮（零运行时产物）。
 *
 * 设计意图 (Why)：
 *   词条片段一旦被加类型注解（如 `Record<string, string>`），该域 key 会从 I18nKey
 *   联合中消失（消费者 t() 调用报 TS2345）；若 I18nKey 整体退化为 string，则本文件报 TS2344。
 *   本文件逐域断言 key 仍为字面量联合，把两类退化都变成 tsc 报错，而不是靠消费者偶然踩中。
 *
 * 约束与规则 (Rules)：
 *   1. 本文件只允许 `import type` / `export type`，禁止写任何可执行语句与运行时导出；
 *   2. 新增域片段时必须同步登记一条 `<Domain>KeysLiteral` 断言，否则新域退化不受守；
 *   3. 类型声明集中在本文件而非 index.ts：它们没有运行时语义，混在可执行源码里
 *      会污染增量覆盖率的分母，逼出无意义的测试。
 */
import type { I18nKey } from './index.js';
import type { zhChrome } from './messages/chrome.js';
import type { zhSettings } from './messages/settings.js';
import type { zhSlash } from './messages/slash.js';
import type { zhBot } from './messages/bot.js';
import type { zhConversation } from './messages/conversation.js';
import type { zhDock } from './messages/dock.js';
import type { zhInspector } from './messages/inspector.js';
import type { zhAgents } from './messages/agents.js';
import type { zhGallery } from './messages/gallery.js';

export type IsLiteralUnion<T> = string extends T ? false : true;
export type AssertTrue<T extends true> = T;

export type I18nKeyLiteralGuard = AssertTrue<IsLiteralUnion<I18nKey>>;

export type ChromeKeysLiteral = AssertTrue<IsLiteralUnion<keyof typeof zhChrome>>;
export type SettingsKeysLiteral = AssertTrue<IsLiteralUnion<keyof typeof zhSettings>>;
export type SlashKeysLiteral = AssertTrue<IsLiteralUnion<keyof typeof zhSlash>>;
export type BotKeysLiteral = AssertTrue<IsLiteralUnion<keyof typeof zhBot>>;
export type ConversationKeysLiteral = AssertTrue<IsLiteralUnion<keyof typeof zhConversation>>;
export type DockKeysLiteral = AssertTrue<IsLiteralUnion<keyof typeof zhDock>>;
export type InspectorKeysLiteral = AssertTrue<IsLiteralUnion<keyof typeof zhInspector>>;
export type AgentsKeysLiteral = AssertTrue<IsLiteralUnion<keyof typeof zhAgents>>;
export type GalleryKeysLiteral = AssertTrue<IsLiteralUnion<keyof typeof zhGallery>>;
