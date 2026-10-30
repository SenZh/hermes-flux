/**
 * 门禁报告器（统一输出契约）
 *
 * 设计意图 (Why):
 *   Agent 与人类消费同一份结构化结果。人类看表格，Agent 看 JSON 指纹，
 *   二者必须来自同一次扫描，避免「人看到绿、Agent 拿到红」的口径分裂。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 只在终端打印彩色文本 -> Agent 无法解析，只能靠肉眼复述，必然失真。
 *   2. 违规消息里带绝对路径 -> 不同机器 baseline 互不兼容。
 *
 * 约束与规则 (Rules):
 *   - 所有路径一律 POSIX 相对路径。
 *   - 退出码语义固定：0 通过 / 1 存在阻断违规 / 2 执行异常。
 */

const C = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[36m',
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `${code}${text}${C.reset}` : text);

export function heading(text) {
  return `\n${paint(C.bold + C.blue, '▌')} ${paint(C.bold, text)}`;
}

export function formatViolation(v) {
  const loc = `${v.file}${v.line ? `:${v.line}` : ''}`;
  return `  ${paint(C.red, '✗')} ${paint(C.dim, loc)}  ${v.message}${v.snippet ? paint(C.dim, `  「${v.snippet}」`) : ''}`;
}

export function formatRuleSummary(rule, { blocking, frozen, fixed }) {
  const status = blocking > 0 ? paint(C.red, 'FAIL') : fixed > 0 ? paint(C.green, 'FIXED') : paint(C.green, 'PASS');
  const parts = [`新增 ${blocking}`];
  if (frozen > 0) parts.push(`存量债务 ${frozen}`);
  if (fixed > 0) parts.push(`已清偿 ${fixed}`);
  return `  ${status.padEnd(useColor ? 14 : 5)} ${rule.padEnd(42)} ${paint(C.dim, parts.join(' · '))}`;
}

export function warnLine(text) {
  return `  ${paint(C.yellow, '!')} ${text}`;
}

export function okLine(text) {
  return `  ${paint(C.green, '✓')} ${text}`;
}

export { paint, C };
