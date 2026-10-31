/**
 * IPC for Home's Spend card: today's dollars and the limit, from the brain's spend_today tool.
 * Contains registerSpendIpc.
 */

import type { SpendToday } from '@tagalong/ui';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

interface SpendIpcDeps {
  /** The brain's tools: today's spend comes from it. */
  brain: BrainCall;
}

export function registerSpendIpc(handle: IpcHandle, { brain }: SpendIpcDeps): void {
  // The brain knows today's dollars and the limit; there is no month or by-provider split.
  handle(IPC.usageSummary, async (): Promise<SpendToday> => {
    const spend = (await callJson(brain, 'spend_today')) as {
      spent_usd?: unknown;
      limit_usd?: unknown;
    } | null;
    if (typeof spend?.spent_usd !== 'number') throw new Error('brain sent bad spend');
    return {
      spentUsd: spend.spent_usd,
      limitUsd: typeof spend.limit_usd === 'number' ? spend.limit_usd : null,
    };
  });
}
