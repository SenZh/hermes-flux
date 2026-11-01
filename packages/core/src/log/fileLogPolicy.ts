/**
 * 日志文件策略（纯函数，可测）
 *
 * 设计意图 (Why):
 *   落盘策略（按天命名、保留天数、单文件上限、队列溢出）如果直接写死在
 *   Electron 主进程里，就无法被单测覆盖，只能靠"跑一次看看"。
 *   把策略抽成纯函数后，边界条件（跨天、超限、溢出）都能确定性验证。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 不按天切分会写出几百 MB 的单文件，用户打不开也传不回来；
 *   2. 无上限会写爆磁盘；
 *   3. 队列无上限会在渲染热路径打日志时把内存吃光。
 *
 * 约束与规则 (Rules):
 *   - 纯函数，零 I/O；文件名格式固定 `flux-YYYY-MM-DD.log`；
 *   - 日期按本地时区计算，跨天时调用方负责切换文件。
 */

export const LOG_FILE_PREFIX = 'flux-';
export const LOG_FILE_MAX_BYTES = 32 * 1024 * 1024;
export const LOG_RETENTION_DAYS = 7;
export const LOG_MAX_QUEUE = 2000;

/** 本地时区的 YYYY-MM-DD */
export function logDayStamp(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 当天日志文件名 */
export function logFileName(date: Date = new Date()): string {
  return `${LOG_FILE_PREFIX}${logDayStamp(date)}.log`;
}

/** 是否为合法的日志文件名（用于清理时避免误删） */
export function isLogFileName(name: string): boolean {
  return /^flux-\d{4}-\d{2}-\d{2}\.log$/.test(name);
}

/**
 * 判断该文件是否应被清理。
 *
 * @param mtimeMs 文件修改时间
 * @param nowMs 当前时间
 * @param retentionDays 保留天数
 */
export function shouldPruneLog(mtimeMs: number, nowMs: number, retentionDays = LOG_RETENTION_DAYS): boolean {
  const cutoff = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  return mtimeMs < cutoff;
}

/** 文件是否已达大小上限 */
export function isLogFileFull(sizeBytes: number, maxBytes = LOG_FILE_MAX_BYTES): boolean {
  return sizeBytes > maxBytes;
}

/** 队列是否已满（满了就丢弃并计数，绝不无限增长） */
export function isQueueFull(queueLength: number, maxQueue = LOG_MAX_QUEUE): boolean {
  return queueLength >= maxQueue;
}
