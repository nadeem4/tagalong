/**
 * IPC for Home's Bodies section: read which bodies are connected and how WhatsApp is set up,
 * and save WhatsApp settings. Both go through the brain's Home tools (bodies_status,
 * whatsapp_status, whatsapp_set). Contains registerBodiesIpc. A pasted secret is forwarded once;
 * it is never kept, logged, returned or put in a thrown error.
 */

import { parseBodiesState } from '@tagalong/ui/shapes';
import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

// Strict, so a page cannot slip an argument the brain tool does not know.
const Change = z
  .object({
    enabled: z.boolean(),
    accessToken: z.string(),
    appSecret: z.string(),
    verifyToken: z.string(),
    phoneNumberId: z.string(),
    allowedNumber: z.string(),
    port: z.number().int(),
  })
  .partial()
  .strict();

const WIRE_NAMES = {
  enabled: 'enabled',
  accessToken: 'access_token',
  appSecret: 'app_secret',
  verifyToken: 'verify_token',
  phoneNumberId: 'phone_number_id',
  allowedNumber: 'allowed_number',
  port: 'port',
} as const;

export function registerBodiesIpc(handle: IpcHandle, deps: { brain: BrainCall }): void {
  const { brain } = deps;

  handle(IPC.bodiesState, async () => {
    const [bodies, whatsapp] = await Promise.all([
      callJson(brain, 'bodies_status') as Promise<{ bodies?: unknown }>,
      callJson(brain, 'whatsapp_status'),
    ]);
    return parseBodiesState({ bodies: bodies.bodies, whatsapp });
  });

  // The secrets are parameters, never variables that outlive the call. Errors are rebuilt from
  // fixed text so nothing the brain or the socket says can carry one back.
  handle(IPC.whatsappSet, async (_event, raw: unknown): Promise<void> => {
    const change = Change.safeParse(raw);
    if (!change.success) throw new Error('Scout could not read those WhatsApp settings.');
    const args: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(change.data)) {
      args[WIRE_NAMES[key as keyof typeof WIRE_NAMES]] = value;
    }
    try {
      await callJson(brain, 'whatsapp_set', args);
    } catch {
      // No `cause` on purpose: a chained error could carry the secret into a log.
      throw new Error('Scout could not save the WhatsApp settings.');
    }
  });
}
