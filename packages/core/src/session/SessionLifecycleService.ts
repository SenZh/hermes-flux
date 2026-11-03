import type { IPlatformBridge } from '../pal/IPlatformBridge.js';
import type { RestFallbackHandler } from '../rpc/client.js';
import { RpcErrorCode } from '../rpc/RpcErrorCode.js';
import { createLogger } from '../log/logger.js';

const log = createLogger('session-lifecycle');

export interface SessionLifecycleRpc {
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
}

export type DeleteOutcome =
  | { status: 'deleted'; pruneIds: string[]; hiddenProfiles: string[]; failedProfiles: [] }
  | { status: 'partial'; pruneIds: string[]; hiddenProfiles: string[]; failedProfiles: string[] }
  | { status: 'failed'; pruneIds: []; hiddenProfiles: []; failedProfiles: string[] };

export interface SessionLifecycleOptions {
  rpc: SessionLifecycleRpc;
  platformBridge?: Pick<IPlatformBridge, 'httpProxy'>;
  restFallback?: RestFallbackHandler;
  baseUrl?: () => string;
  ticket?: () => string | undefined;
}

function rpcCode(error: unknown): number | null {
  if (error instanceof Error && 'code' in error && typeof error.code === 'number') return error.code;
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'number') return error.code;
  return null;
}

/** 删除编排只负责远端操作与结构化结果，界面清理由调用方消费 outcome。 */
export class SessionLifecycleService {
  constructor(private readonly options: SessionLifecycleOptions) {}

  public async deleteSession(sessionId: string, profiles: string[]): Promise<DeleteOutcome> {
    const uniqueProfiles = [...new Set(profiles.filter(Boolean))];
    const failedProfiles: string[] = [];
    const hiddenProfiles: string[] = [];
    try {
      await this.options.rpc.call('session.close', { session_id: sessionId });
    } catch (error: unknown) {
      log.debug('Session close failed during deletion', { sessionId, error });
    }
    try {
      await this.options.rpc.call('session.interrupt', { session_id: sessionId });
    } catch (error: unknown) {
      log.debug('Session interrupt failed during deletion', { sessionId, error });
    }
    for (const profile of uniqueProfiles) {
      let profileDeleted = false;
      try {
        await this.options.rpc.call('session.delete', { session_id: sessionId, profile });
        profileDeleted = true;
      } catch (error: unknown) {
        if (rpcCode(error) === RpcErrorCode.ActiveSession) {
          try {
            await this.options.rpc.call('session.set_hidden', { session_id: sessionId, hidden: true, profile });
            hiddenProfiles.push(profile);
            profileDeleted = true;
          } catch (error: unknown) {
            log.warn('Session hide fallback failed', { sessionId, profile, error });
          }
        }
      }
      const request = {
        baseUrl: this.options.baseUrl?.() ?? '',
        path: `/api/sessions/${encodeURIComponent(sessionId)}?profile=${encodeURIComponent(profile)}`,
        method: 'DELETE',
        ticket: this.options.ticket?.(),
      };
      try {
        if (this.options.platformBridge?.httpProxy) {
          await this.options.platformBridge.httpProxy(request);
          markProfileDeleted();
        } else if (this.options.restFallback) {
          await this.options.restFallback(request.path, { method: 'DELETE' });
          markProfileDeleted();
        }
      } catch (error: unknown) {
        log.warn('REST session deletion failed', { sessionId, profile, error });
      }
      if (!profileDeleted) failedProfiles.push(profile);

      function markProfileDeleted(): void {
        profileDeleted = true;
      }
    }
    if (failedProfiles.length === uniqueProfiles.length) {
      return { status: 'failed', pruneIds: [], hiddenProfiles: [], failedProfiles };
    }
    const status = failedProfiles.length === 0 ? 'deleted' : 'partial';
    return status === 'deleted'
      ? { status, pruneIds: [sessionId], hiddenProfiles, failedProfiles: [] }
      : { status, pruneIds: [sessionId], hiddenProfiles, failedProfiles };
  }
}
