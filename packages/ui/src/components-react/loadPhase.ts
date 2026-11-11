/**
 * 首屏数据相位（加载中 / 已就绪）。
 *
 * 设计意图 (Why)：
 *   骨架屏只在"数据尚未到达"时出现。数据一旦到达——哪怕是空结果或拉取失败——
 *   必须切到 ready 交给真实空态与错误行，否则骨架会永久假加载，把故障伪装成慢。
 *
 * 防范的历史坑 (Pitfall)：
 *   用松散 boolean 拼装加载态时，失败分支漏复位会留下永不消失的骨架；
 *   反过来把"空"当成"加载中"又会让用户永远等不到"此处确实没有数据"的结论。
 *
 * 约束与规则 (Rules)：
 *   1. 缺省视为 ready —— 所有既有调用方（gallery、静态渲染、测试）未提供相位时，
 *      行为必须与改造前逐字节一致；
 *   2. 只表达"首次到达"这一个维度，不承载失败原因（失败由各域自己的 error 字段承担）。
 */
export type DataPhase = 'loading' | 'ready';

export function resolveDataPhase(value: DataPhase | undefined): DataPhase {
  return value === 'loading' ? 'loading' : 'ready';
}
