/**
 * What Home's Bodies section reads of the brain: which bodies are connected and how WhatsApp is
 * set up. Contains parseBodiesState, BodiesState and WhatsAppChange, shaped after bodies_status
 * and whatsapp_status (brain/src/brain/bodies_tools.py). It never holds a secret: `set` only
 * says which values are saved.
 */
import { z } from 'zod';

const Body = z.object({
  kind: z.enum(['desktop', 'browser', 'whatsapp']),
  name: z.string(),
  connected: z.boolean(),
});

const Wire = z.object({
  bodies: z.array(Body),
  whatsapp: z.object({
    enabled: z.boolean(),
    set: z.object({
      access_token: z.boolean(),
      app_secret: z.boolean(),
      verify_token: z.boolean(),
      phone_number_id: z.boolean(),
      allowed_number: z.boolean(),
    }),
    complete: z.boolean(),
    state: z.string(),
    port: z.number(),
  }),
});

export type WhatsAppField =
  'accessToken' | 'appSecret' | 'verifyToken' | 'phoneNumberId' | 'allowedNumber';

export interface BodiesState {
  bodies: z.infer<typeof Body>[];
  whatsapp: {
    enabled: boolean;
    set: Record<WhatsAppField, boolean>;
    complete: boolean;
    /** The bridge's state word: off, incomplete, starting, running, not_built, node_failed. */
    state: string;
    port: number;
  };
}

/** Only the keys present change. The secrets travel once, from the field to the brain. */
export interface WhatsAppChange {
  enabled?: boolean;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
  phoneNumberId?: string;
  allowedNumber?: string;
  port?: number;
}

export function parseBodiesState(json: unknown): BodiesState {
  const { bodies, whatsapp: w } = Wire.parse(json);
  return {
    bodies,
    whatsapp: {
      enabled: w.enabled,
      set: {
        accessToken: w.set.access_token,
        appSecret: w.set.app_secret,
        verifyToken: w.set.verify_token,
        phoneNumberId: w.set.phone_number_id,
        allowedNumber: w.set.allowed_number,
      },
      complete: w.complete,
      state: w.state,
      port: w.port,
    },
  };
}
