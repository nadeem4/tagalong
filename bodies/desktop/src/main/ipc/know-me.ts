/**
 * IPC for get to know me: the sources Home lists, starting a run, and the run's status pushed to
 * every window. A refusal comes back as `{ error }` with a plain sentence, because an IPC
 * rejection would wrap it in Electron's own text. Contains registerKnowMeIpc.
 */

import { BrainOffline, RpcError } from '@tagalong/contract';
import type { BrainClient } from '@tagalong/contract';
import { KnowMeInput, KnowMeStatus, KnowSourceInfo } from '@tagalong/ui/shapes';
import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

/** The brain's own limit; checked here too so a huge file never crosses the socket. */
const PDF_MAX_BYTES = 10 * 1024 * 1024;
// Same rule as the contract's know_me_start username; checked here so the brain's raw
// invalid_params text never reaches the form.
const GITHUB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const OVER_LIMIT = -32008;

type KnowBrain = BrainCall & Pick<BrainClient, 'knowMeStart' | 'onKnowMeStatus'>;

/** Bytes a base64 string decodes to, without decoding it. */
function decodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function registerKnowMeIpc(
  handle: IpcHandle,
  deps: { brain: KnowBrain; broadcast: (channel: string, payload: unknown) => void },
): void {
  const { brain, broadcast } = deps;

  handle(IPC.knowMeSources, async () => {
    const parsed = z.array(KnowSourceInfo).safeParse(await callJson(brain, 'know_me_sources'));
    if (!parsed.success) throw new Error('brain sent bad know_me_sources answer');
    return parsed.data;
  });

  handle(IPC.knowMeStart, async (_event, raw: unknown) => {
    const input = KnowMeInput.safeParse(raw);
    const github = input.success ? input.data.github?.trim() : undefined;
    const pdf = input.success ? input.data.pdf : undefined;
    if (!input.success || (!github && !pdf)) {
      return { error: 'Give a GitHub username or a LinkedIn PDF.' };
    }
    if (github && !GITHUB_NAME.test(github)) {
      return { error: 'That is not a GitHub username.' };
    }
    if (pdf && decodedBytes(pdf.data) > PDF_MAX_BYTES) {
      return { error: 'That PDF is over 10 MB.' };
    }
    try {
      return await brain.knowMeStart({
        ...(github ? { github } : {}),
        ...(pdf ? { pdf } : {}),
      });
    } catch (error) {
      if (error instanceof BrainOffline) return { error: 'Scout is not connected right now.' };
      if (error instanceof RpcError) {
        return { error: error.code === OVER_LIMIT ? 'That PDF is over 10 MB.' : error.message };
      }
      throw error;
    }
  });

  // Live frames from the brain: one that is not a status is dropped, not shown.
  brain.onKnowMeStatus((status) => {
    const parsed = KnowMeStatus.safeParse(status);
    if (parsed.success) broadcast(IPC.knowMeStatusEvent, parsed.data);
  });
}
