/**
 * IPC for Settings' Voice page: Scout's voice download (voice_download, fetch_voice), and for the
 * Speech to text card: read the speech-model choice and set it. Both go through
 * the brain's Home tools (stt_state, set_stt); the brain owns the model list and refuses an id it
 * does not know. The page is not trusted, so the pick is checked to be text before the brain
 * hears of it. Contains registerVoiceModelsIpc.
 */

import { parseSttState, parseVoiceDownload } from '@tagalong/ui/shapes';
import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

const Pick = z
  .object({ live: z.string().min(1).optional(), final: z.string().min(1).optional() })
  .strict()
  .refine((pick) => pick.live !== undefined || pick.final !== undefined, 'pick a model');

export function registerVoiceModelsIpc(handle: IpcHandle, deps: { brain: BrainCall }): void {
  const { brain } = deps;
  handle(IPC.sttState, async () => parseSttState(await callJson(brain, 'stt_state')));
  handle(IPC.sttSet, async (_event, pick: unknown) => {
    await callJson(brain, 'set_stt', Pick.parse(pick));
  });
  handle(IPC.voiceDownload, async () =>
    parseVoiceDownload(await callJson(brain, 'voice_download')),
  );
  handle(IPC.voiceFetch, async (_event, retry: unknown) => {
    await callJson(brain, 'fetch_voice', retry === true ? { retry: true } : {});
  });
}

/** The first-run tour is open: the brain fetches the voice now. Idempotent there; a brain that is
 * not up yet is asked again when it comes online. */
export async function startVoiceFetch(brain: BrainCall): Promise<void> {
  try {
    await callJson(brain, 'fetch_voice');
  } catch (error) {
    console.warn('[voice] could not start the voice fetch', error);
  }
}
