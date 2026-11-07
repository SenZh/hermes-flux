/**
 * HTML 转义（唯一实现）
 *
 * 设计意图 (Why)：
 *   escapeHtml 是纯字符串工具，被模板组件、头像渲染与主模板共同依赖。
 *   一旦它寄生在 MiddlePod 里，任何 `import { escapeHtml } from './MiddlePod.js'`
 *   都会把整条 React 依赖链拽进纯模板模块，浏览器直接加载时解析裸说明符 'react' 失败。
 *
 * 防范的历史坑 (Pitfall)：
 *   advanced-systems CDP harness 因此整页初始化崩溃，window.cdpState 根本没建立，
 *   测试只看到一堆 undefined，被误判为「断言过时」。
 *
 * 约束与规则 (Rules)：
 *   1. 本文件禁止引入任何其它模块，保持零依赖；
 *   2. 只做五个字符的转义，不承担任何 HTML 清洗或白名单职责。
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
