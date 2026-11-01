import fs from 'node:fs';
import path from 'node:path';
import { formatLogRecord, addLogSink, type LogRecord } from '@hermes-flux/core';
import {
  logFileName,
  isLogFileName,
  shouldPruneLog,
  isLogFileFull,
  isQueueFull,
  LOG_FILE_MAX_BYTES,
} from '@hermes-flux/core';

/**
 * Hermes Flux Desktop 日志落盘
 *
 * 设计意图 (Why):
 *   现场故障必须留下可回传的物理证据。日志写入 `userData/logs/flux-YYYY-MM-DD.log`，
 *   用户只需把日志目录发回来，Agent 就能看到完整的 RPC 参数、错误码与链路节点，
 *   不必再让用户开 DevTools 手抄 console。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 同步 appendFileSync 在渲染热路径高频触发会阻塞主进程事件循环，
 *      因此改为串行队列 + 异步追加，且队列长度设上限，溢出时丢弃并计数。
 *   2. 不按天切分会写出单个几百 MB 的巨型文件，打开即卡死编辑器；
 *      必须按日期命名并在启动时清理过期文件。
 *   3. 磁盘写满或权限不足时若让异常冒泡，会连带拖垮业务调用，
 *      因此所有 I/O 失败都必须被吞掉并降级为控制台提示。
 *
 * 约束与规则 (Rules):
 *   - 策略（命名/保留/上限/队列）全部来自 core 的纯函数，便于单测；
 *   - 本文件只负责把策略接到真实文件系统上；
 *   - 写入顺序必须与产生顺序一致（串行队列）。
 */

export interface FileLogHandle {
  logDir: string;
  /** 等待队列写完（退出前调用） */
  flush: () => Promise<void>;
  dispose: () => void;
}

let handle: FileLogHandle | null = null;
/** 统一写入入口：主进程自身记录与渲染进程转发记录共用同一条队列 */
let enqueueLine: ((line: string) => void) | null = null;

function pruneOldLogs(logDir: string): void {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(logDir)) {
      if (!isLogFileName(name)) continue;
      const abs = path.join(logDir, name);
      try {
        if (shouldPruneLog(fs.statSync(abs).mtimeMs, now)) fs.unlinkSync(abs);
      } catch (err) {
        // gate-degrade: 清理过期日志时单个文件被占用不应中断整轮清理
        void err;
      }
    }
  } catch (err) {
    // gate-degrade: 日志目录不可读时放弃清理，不能因此影响应用启动
    void err;
  }
}

/**
 * 初始化文件日志 sink。
 *
 * @param userDataDir Electron `app.getPath('userData')`
 */
export function initFileLogging(userDataDir: string): FileLogHandle {
  const logDir = path.join(userDataDir, 'logs');
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (err) {
    // gate-degrade: 日志目录创建失败时降级为仅控制台输出，不能阻断启动
    console.warn('[Hermes Flux] cannot create log dir, falling back to console only:', err);
  }
  pruneOldLogs(logDir);

  let queue: string[] = [];
  let writing = false;
  let sizeLimitHit = false;
  let droppedLines = 0;

  const drain = async (): Promise<void> => {
    if (writing) return;
    writing = true;
    while (queue.length > 0) {
      const batch = queue;
      queue = [];
      const file = path.join(logDir, logFileName());
      try {
        const stat = fs.existsSync(file) ? fs.statSync(file) : null;
        if (stat && isLogFileFull(stat.size, LOG_FILE_MAX_BYTES)) {
          if (!sizeLimitHit) {
            sizeLimitHit = true;
            console.warn(`[Hermes Flux] log file exceeded ${LOG_FILE_MAX_BYTES} bytes, further entries dropped: ${file}`);
          }
          continue;
        }
        await fs.promises.appendFile(file, batch.join(''), 'utf8');
      } catch (err) {
        // gate-degrade: 磁盘满或权限不足时丢弃本批日志，日志失败不得影响业务
        void err;
      }
    }
    writing = false;
  };

  enqueueLine = (line: string): void => {
    if (isQueueFull(queue.length)) {
      droppedLines += 1;
      return;
    }
    queue.push(line);
    void drain();
  };

  const removeSink = addLogSink((record: LogRecord) => enqueueLine?.(formatLogRecord(record)), 'debug');

  handle = {
    logDir,
    flush: async () => {
      const started = Date.now();
      while ((writing || queue.length > 0) && Date.now() - started < 2000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (droppedLines > 0) {
        try {
          await fs.promises.appendFile(
            path.join(logDir, logFileName()),
            `${new Date().toISOString()} WARN  [main] log queue overflow, dropped ${droppedLines} line(s)\n`,
            'utf8'
          );
        } catch (err) {
          // gate-degrade: 队列溢出统计写盘失败时无处再记，只能放弃
          void err;
        }
      }
    },
    dispose: () => {
      removeSink();
      enqueueLine = null;
      handle = null;
    },
  };

  return handle;
}

/** 渲染进程经 IPC 转发进来的记录，与主进程共用同一条落盘队列 */
export function appendExternalLogRecord(record: LogRecord): void {
  enqueueLine?.(formatLogRecord(record));
}

/** 当前日志目录（供“打开日志目录”入口使用） */
export function getLogDir(): string | null {
  return handle?.logDir ?? null;
}
