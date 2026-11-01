/**
 * Hermes Flux leveled logger with pluggable sinks.
 *
 * 设计意图 (Why):
 *   排查必须基于证据，而证据必须能落盘。此前日志只进 console，
 *   用户现场出问题时只能靠 F12 或远程口述，Agent 拿不到任何一手数据。
 *   因此把「记录产生」与「记录消费」解耦：core 只负责产生结构化记录，
 *   由宿主（桌面主进程 / 移动端 / 测试）注入落盘 sink。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 只打 console 不落文件 -> 用户报障时没有任何可回传的证据，
 *      只能靠复述现象反推，这正是"修了很久"的直接原因之一。
 *   2. 单个阈值同时控制控制台与文件 -> 为了控制台干净不得不关掉 debug，
 *      结果落盘也丢了 debug。因此必须给每个 sink 独立阈值。
 *   3. data 里带 Error / 循环引用 -> JSON.stringify 直接抛错，
 *      日志写入把调用方业务逻辑一起带崩。序列化必须容错。
 *
 * 约束与规则 (Rules):
 *   - 纯 TypeScript，零 DOM / 零 node:fs 依赖，宿主通过 sink 注入 I/O。
 *   - 记录分发失败绝不允许向上抛出（日志不能影响业务）。
 *   - 级别语义：silent < error < warn < info < debug < trace；
 *     sink 的 minLevel 表示「最细粒度到哪一级」，更细的被丢弃。
 */

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

/** 一条结构化日志记录；落盘与上报都以此为单位 */
export interface LogRecord {
  /** Unix 毫秒时间戳 */
  ts: number;
  /** ISO8601，便于人读与跨时区对齐 */
  iso: string;
  level: Exclude<LogLevel, 'silent'>;
  scope: string;
  message: string;
  data?: unknown;
}

export type LogSink = (record: LogRecord) => void;

interface RegisteredSink {
  sink: LogSink;
  minLevel: LogLevel;
}

/**
 * 文件落盘阈值：默认 debug。
 * 现场排障需要 debug 级别的参数、响应码与链路节点，文件成本远低于复现成本。
 */
let fileLevel: LogLevel = 'debug';
/** 控制台阈值：默认 info，避免开发时刷屏；需要时用 ?log=debug 提升 */
let consoleLevel: LogLevel = 'info';

const registeredSinks: RegisteredSink[] = [];

function weight(level: LogLevel): number {
  return LEVEL_WEIGHT[level];
}

/** 该级别是否达到给定阈值（阈值越细，能通过的级别越多） */
export function isLogLevelEnabled(level: LogLevel, threshold: LogLevel = fileLevel): boolean {
  if (level === 'silent') return false;
  return weight(level) <= weight(threshold);
}

/** 兼容旧调用：同时设置文件与控制台阈值 */
export function setLogLevel(level: LogLevel): void {
  fileLevel = level;
  consoleLevel = level;
}

export function setFileLogLevel(level: LogLevel): void {
  fileLevel = level;
}

export function setConsoleLogLevel(level: LogLevel): void {
  consoleLevel = level;
}

export function getLogLevel(): LogLevel {
  return fileLevel;
}

export function getConsoleLogLevel(): LogLevel {
  return consoleLevel;
}

/** Parses any user-supplied string into a valid level, falling back to `fallback`. */
export function parseLogLevel(value: unknown, fallback: LogLevel = 'info'): LogLevel {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVEL_WEIGHT, normalized)
    ? (normalized as LogLevel)
    : fallback;
}

/**
 * 注册一个 sink。返回注销函数。
 *
 * @param sink 消费记录的函数（宿主在此写文件 / 上报 / 转发 IPC）
 * @param minLevel 该 sink 接收的最细级别，默认跟随文件阈值
 */
export function addLogSink(sink: LogSink, minLevel: LogLevel = fileLevel): () => void {
  const entry: RegisteredSink = { sink, minLevel };
  registeredSinks.push(entry);
  return () => {
    const idx = registeredSinks.indexOf(entry);
    if (idx >= 0) registeredSinks.splice(idx, 1);
  };
}

/** 清空所有 sink（测试用） */
export function clearLogSinks(): void {
  registeredSinks.length = 0;
}

/**
 * 容错序列化：Error / 循环引用 / BigInt / 函数都必须能安全转成文本。
 * 任何失败都退化为 String(value)，绝不抛出。
 */
export function safeSerialize(value: unknown, maxLength = 4000): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return value.length > maxLength ? `${value.slice(0, maxLength)}…(${value.length} chars)` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'function') return `[Function ${(value as { name?: string }).name || 'anonymous'}]`;

  if (value instanceof Error) {
    const extra: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (key === 'stack' || key === 'message' || key === 'name') continue;
      extra[key] = val;
    }
    const tail = Object.keys(extra).length > 0 ? ` ${safeSerialize(extra, maxLength)}` : '';
    return `${value.name}: ${value.message}${tail}`;
  }

  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(value, (_key, val) => {
      if (typeof val === 'bigint') return `${val.toString()}n`;
      if (typeof val === 'function') return `[Function ${val.name || 'anonymous'}]`;
      if (val instanceof Error) return `${val.name}: ${val.message}`;
      if (val && typeof val === 'object') {
        if (seen.has(val as object)) return '[Circular]';
        seen.add(val as object);
      }
      return val;
    });
    if (typeof json !== 'string') return String(value);
    return json.length > maxLength ? `${json.slice(0, maxLength)}…(${json.length} chars)` : json;
  } catch {
    try {
      return String(value).slice(0, maxLength);
    } catch {
      return '[Unserializable]';
    }
  }
}

/** 默认控制台 sink：按控制台阈值过滤，按严重级别分流到对应 channel */
const consoleSink: LogSink = (record) => {
  if (!isLogLevelEnabled(record.level, consoleLevel)) return;
  const prefix = `[Flux:${record.scope}] ${record.message}`;
  const sink =
    record.level === 'error'
      ? console.error
      : record.level === 'warn'
        ? console.warn
        : record.level === 'info'
          ? console.info
          : console.debug;
  if (typeof record.data === 'undefined') {
    sink(prefix);
  } else {
    sink(prefix, record.data);
  }
};

addLogSink(consoleSink, 'trace');

function dispatch(record: LogRecord): void {
  for (const entry of registeredSinks) {
    if (!isLogLevelEnabled(record.level, entry.minLevel)) continue;
    try {
      entry.sink(record);
    // gate-degrade: 日志 sink 自身故障时无法再写日志（递归），只能丢弃该条记录
    } catch {
      // 日志 sink 故障不得影响业务调用链
    }
  }
}

function emit(scope: string, level: Exclude<LogLevel, 'silent'>, message: string, data?: unknown): void {
  // 只要有任何 sink 能接收该级别就必须构造记录
  const deliverable = registeredSinks.some((entry) => isLogLevelEnabled(level, entry.minLevel));
  if (!deliverable) return;

  const now = Date.now();
  dispatch({
    ts: now,
    iso: new Date(now).toISOString(),
    level,
    scope,
    message,
    data,
  });
}

export interface FluxLogger {
  error(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
  trace(message: string, data?: unknown): void;
  /** Starts a timer; calling the returned function logs the elapsed milliseconds. */
  time(label: string): (data?: unknown) => number;
}

export function createLogger(scope: string): FluxLogger {
  return {
    error: (message, data) => emit(scope, 'error', message, data),
    warn: (message, data) => emit(scope, 'warn', message, data),
    info: (message, data) => emit(scope, 'info', message, data),
    debug: (message, data) => emit(scope, 'debug', message, data),
    trace: (message, data) => emit(scope, 'trace', message, data),
    time: (label) => {
      const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      return (data?: unknown) => {
        const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const elapsed = Math.round((finishedAt - startedAt) * 10) / 10;
        emit(scope, 'debug', `${label} took ${elapsed}ms`, data);
        return elapsed;
      };
    },
  };
}

/** 把一条记录渲染成单行文本（文件 sink 使用） */
export function formatLogRecord(record: LogRecord): string {
  const head = `${record.iso} ${record.level.toUpperCase().padEnd(5)} [${record.scope}] ${record.message}`;
  if (typeof record.data === 'undefined') return `${head}\n`;
  return `${head} ${safeSerialize(record.data)}\n`;
}
