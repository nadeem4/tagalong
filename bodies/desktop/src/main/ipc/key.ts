/**
 * IPC for the Anthropic key: key:status, key:set, limit:set and expert:status, each a thin call
 * to the brain's tool of the same job. Contains registerKeyIpc and readKeyStatus. The pasted key is forwarded
 * once; it is never kept, logged, returned or put in a thrown error.
 */

import { BrainOffline, RpcError } from '@tagalong/contract';
import type { ExpertStatus, KeyResult, KeyStatus } from '../../shared/ipc';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

interface KeyIpcDeps {
  brain: BrainCall;
  /** Opens an address in the user's browser (shell.openExternal). */
  openExternal: (url: string) => Promise<void>;
}

// Fixed here, never taken from the renderer, so a compromised page cannot open anything else.
const KEY_PAGE = 'https://console.anthropic.com/settings/keys';

const RESULTS = ['ok', 'invalid', 'unreachable'] as const;

/** The brain's key facts (never the key itself). Throws when the brain is offline or odd. */
export async function readKeyStatus(brain: BrainCall): Promise<KeyStatus> {
  const status = (await callJson(brain, 'key_status')) as {
    has_key?: unknown;
    source?: unknown;
    env_path?: unknown;
    daily_limit_usd?: unknown;
  } | null;
  if (
    typeof status?.has_key !== 'boolean' ||
    (status.source !== 'environment' && status.source !== 'file' && status.source !== 'none') ||
    typeof status.env_path !== 'string' ||
    typeof status.daily_limit_usd !== 'number'
  ) {
    throw new Error('brain sent bad key status');
  }
  return {
    hasKey: status.has_key,
    source: status.source,
    envPath: status.env_path,
    dailyLimitUsd: status.daily_limit_usd,
  };
}

export function registerKeyIpc(handle: IpcHandle, { brain, openExternal }: KeyIpcDeps): void {
  handle(IPC.keyStatus, () => readKeyStatus(brain));
  handle(IPC.keyOpenPage, () => openExternal(KEY_PAGE));

  // The key is a parameter, never a variable that outlives the call; errors are rebuilt
  // from fixed text so nothing the brain or the socket says can carry it back.
  handle(IPC.keySet, async (_event: unknown, key: string): Promise<KeyResult> => {
    try {
      const answer = (await callJson(brain, 'set_api_key', { key })) as { status?: unknown } | null;
      const status = RESULTS.find((result) => result === answer?.status);
      if (status === undefined) throw new Error('brain sent bad key answer');
      return status;
    } catch (error) {
      if (error instanceof BrainOffline) return 'offline';
      // No `cause` on purpose: a chained error could carry the pasted key into a log.
      /* eslint-disable preserve-caught-error */
      if (error instanceof RpcError) throw new Error(error.message);
      throw new Error('Scout could not check the key.');
      /* eslint-enable preserve-caught-error */
    }
  });

  handle(IPC.limitSet, async (_event: unknown, usd: number): Promise<void> => {
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) {
      throw new Error('Enter an amount above $0.');
    }
    await brain.call('set_daily_limit', { usd });
  });

  handle(IPC.expertStatus, async (): Promise<ExpertStatus> => {
    const expert = (await callJson(brain, 'expert_status')) as {
      found?: unknown;
      command?: unknown;
    } | null;
    if (typeof expert?.found !== 'boolean' || typeof expert.command !== 'string') {
      throw new Error('brain sent bad expert status');
    }
    return { found: expert.found, command: expert.command };
  });
}
