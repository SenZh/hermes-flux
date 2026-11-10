/**
 * shadcn/ui 风格的类名合并入口。
 *
 * 【设计意图 (Why)】
 *   项目所有 React 组件都经由本函数合并类名，因此"什么算同组冲突"是设计系统的一部分，
 *   不能交给 tailwind-merge 的默认认知（它不认识 text-body / rounded-card 这些语义档位）。
 *
 * 【约束与规则 (Rules)】
 *   1. 实现已迁至 ./tw-merge.ts（含语义档位扩展与三要素说明），本文件只保留公开入口，
 *      避免历史 import 路径大面积失效；
 *   2. 禁止在此直接调用 twMerge —— 默认实例会把语义字号当文本颜色删除。
 */
export { cn } from './tw-merge.js';
