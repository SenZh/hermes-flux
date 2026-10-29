/**
 * Hermes Flux leveled logger.
 *
 * One dependency-free implementation shared by the main process, the renderer
 * and the unit tests. Level is resolved once at boot and can be changed at
 * runtime (settings UI, DevTools, env var) without rebuilding.
 *
 * Usage:
 *   const log = createLogger('renderer');
 *   log.debug('render() start', { messages: state.messages.length });
 *   const done = log.time('session.resume');
 *   ... await rpc ...
 *   done(); // logs "session.resume 842.3ms"
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

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function isLogLevelEnabled(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] <= LEVEL_WEIGHT[currentLevel];
}

/** Parses any user-supplied string into a valid level, falling back to `fallback`. */
export function parseLogLevel(value: unknown, fallback: LogLevel = 'info'): LogLevel {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVEL_WEIGHT, normalized)
    ? (normalized as LogLevel)
    : fallback;
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

function emit(scope: string, level: Exclude<LogLevel, 'silent'>, message: string, data?: unknown): void {
  if (!isLogLevelEnabled(level)) return;

  const prefix = `[Flux:${scope}] ${message}`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.debug;

  if (typeof data === 'undefined') {
    sink(prefix);
  } else {
    sink(prefix, data);
  }
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
