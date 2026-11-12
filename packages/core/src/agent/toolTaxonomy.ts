/**
 * 工具名分类单一真值源（packages/core/src/agent/toolTaxonomy.ts）
 *
 * 【设计意图 (Why)】
 *   同一次工具调用会在两个地方被展示：
 *     1. 消息流里的工具轨迹胶囊（`ToolCapsule.classifyTool`）——决定标签、图标、是否只读折叠；
 *     2. 对话区顶部的在场指示器（`classifyPresenceTool`）——决定「正在读 / 正在运行 / 正在改」。
 *   两处各写一套关键字判定，必然漂移：实测 14 个真实工具名里 4 个判定不一致
 *   （`skill_run`、`write_skill`、`search_read_index`、`delegate_task`），
 *   表现为「轨迹里写『读取』、指示器里写『正在搜索』」的双标。
 *
 *   因此把判定下沉到这里，两个消费者都只做「映射」而不再做「判定」。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. `write_file` 曾被 `file` 关键字排在 `write` 之前误判成只读，写操作被折叠进
 *      「读取 N 个文件」的聚合行，用户看不到正在改哪个文件。故 `write` 必须排在 `read` 之前。
 *   2. `search_read_index` 这类复合名同时含 `search` 与 `read`：语义上它读的是索引，
 *      归类为 `read` 更贴切，故 `read` 排在 `search` 之前。
 *   3. `write_skill` 是技能操作而非文件写入：`skill` 必须排在 `write` 之前，
 *      否则会显示成「正在改 xxx」。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯逻辑，零 DOM / 零 React / 零 i18n：只产出类别与只读标志，文案由表现层拼装；
 *   2. 判定顺序即优先级，改顺序会改变真实工具的分类，必须有表驱动测试兜底；
 *   3. 本函数是唯一判定入口，任何消费者禁止再写一套 `includes` 链。
 */

/**
 * 工具类别（表现层规范类目）。
 *
 * 与 `PresenceToolKind` 的差别：这里是「工具长什么样」的全集，
 * 包含 `write` 与 `skill` 两个在场指示器不需要细分的类目。
 */
export type ToolTaxonomyKind =
  | 'command'
  | 'skill'
  | 'write'
  | 'edit'
  | 'read'
  | 'search'
  | 'agent'
  | 'browser'
  | 'other';

export interface ToolTaxonomy {
  kind: ToolTaxonomyKind;
  /** 只读工具可被聚合折叠成「读取 N 个文件」，写操作必须逐条可见 */
  readOnly: boolean;
}

/**
 * 关键字 → 类别，顺序即优先级。
 *
 * 【规则】改动本表任何一行的相对顺序都会改变真实工具的分类，
 *   必须同步更新 `packages/core/__tests__/agent/toolTaxonomy.test.mjs` 的表驱动用例。
 */
const TAXONOMY_RULES: ReadonlyArray<{ kind: ToolTaxonomyKind; readOnly: boolean; keys: readonly string[] }> = [
  { kind: 'command', readOnly: false, keys: ['shell', 'bash', 'cmd', 'terminal', 'powershell'] },
  // skill 必须早于 write：write_skill 是技能操作，不是文件写入
  { kind: 'skill', readOnly: false, keys: ['skill'] },
  { kind: 'write', readOnly: false, keys: ['write'] },
  { kind: 'edit', readOnly: false, keys: ['edit', 'patch'] },
  // read 早于 search：search_read_index 读的是索引
  { kind: 'read', readOnly: true, keys: ['read', 'cat'] },
  { kind: 'search', readOnly: false, keys: ['grep', 'search', 'glob', 'find'] },
  // delegate 与 subagent 同属委派：模型在回合内通过 delegate_task 派生子代理
  { kind: 'agent', readOnly: false, keys: ['subagent', 'delegate', 'agent'] },
  { kind: 'browser', readOnly: false, keys: ['browser', 'playwright', 'navigate'] },
];

/**
 * 工具名 → 类别与只读标志。
 *
 * 【约束与规则】空名与未命中一律归 `other` 且非只读——宁可让用户看到一条
 *   陌生工具的完整行，也不能把它静默折叠进只读聚合。
 */
export function classifyToolName(name: string): ToolTaxonomy {
  const raw = (name || '').toLowerCase();
  if (!raw) return { kind: 'other', readOnly: false };
  for (const rule of TAXONOMY_RULES) {
    if (rule.keys.some((key) => raw.includes(key))) {
      return { kind: rule.kind, readOnly: rule.readOnly };
    }
  }
  return { kind: 'other', readOnly: false };
}
