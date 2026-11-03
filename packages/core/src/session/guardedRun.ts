import type { FluxLogger } from '../log/logger.js';

export interface SessionGeneration {
  sessionId: string;
  generation: number;
}

export type GuardedRunResult<T> = { status: 'committed'; value: T } | { status: 'discarded' };

export interface GuardedRunLogger {
  debug(message: string, details: SessionGeneration): void;
}

/**
 * 在异步工作开始前冻结会话与代际快照，避免恢复后的旧响应污染新视图。
 * 旧请求只丢弃自身结果，不改变调用方状态；守卫日志保留排查所需的快照。
 */
export async function runGuarded<T>(
  snapshot: SessionGeneration,
  readCurrent: () => SessionGeneration,
  commit: (value: T) => void,
  operation: () => Promise<T>,
  logger?: Pick<FluxLogger, 'debug'> | GuardedRunLogger,
): Promise<GuardedRunResult<T>> {
  const captured = { sessionId: snapshot.sessionId, generation: snapshot.generation };
  const value = await operation();
  const current = readCurrent();
  if (current.sessionId !== captured.sessionId || current.generation !== captured.generation) {
    logger?.debug('Discarded stale session operation', captured);
    return { status: 'discarded' };
  }
  commit(value);
  return { status: 'committed', value };
}
