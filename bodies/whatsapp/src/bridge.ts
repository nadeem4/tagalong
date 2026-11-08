/**
 * The WhatsApp body: a contract v1 client that turns the one allowed sender's texts into
 * `say`, buffers Scout's `reply` until `done`, and sends the finished text back through the
 * Graph API while the 24-hour window is open. It has no tools and shows no display, so the
 * brain treats it as a plain chat body. Asks and buttons arrive in a later slice.
 */
import type { Server } from 'node:http';
import { BrainClient, ReplyParams, type BrainClientOptions } from '@tagalong/contract';
import type { WhatsAppConfig } from './config';
import { createGraph } from './graph';
import { splitReply } from './split';
import { createWebhook, type Inbound } from './webhook';
import { ReplyWindow } from './window';

export const BODY = { id: 'whatsapp', kind: 'whatsapp', name: 'WhatsApp' } as const;
export const CONTEXT = {
  channel: 'whatsapp',
  note: 'text chat on a phone; keep replies short and offer detail on request',
} as const;

export interface BridgeDeps {
  config: WhatsAppConfig;
  openSocket: BrainClientOptions['openSocket'];
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

export function createBridge(deps: BridgeDeps): {
  start(): Promise<void>;
  stop(): Promise<void>;
  webhook: Server;
} {
  const { config, openSocket, now = Date.now, log = () => undefined } = deps;
  const window = new ReplyWindow(now);
  const graph = createGraph({
    phoneNumberId: config.phoneNumberId,
    accessToken: config.accessToken,
    log,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  // Reply text per turn, held until that turn's `done`.
  const buffers = new Map<string, string[]>();

  // One chain for all sends, so parts of two turns never interleave.
  let sending: Promise<void> = Promise.resolve();

  const flush = async (turn: string): Promise<void> => {
    const text = (buffers.get(turn) ?? []).join('');
    buffers.delete(turn);
    if (!window.isOpen()) {
      // Free text after 24 hours is refused by WhatsApp; the desktop chat still has it.
      log('whatsapp: reply dropped, the 24-hour window is closed');
      return;
    }
    for (const part of splitReply(text)) await graph.sendText(config.allowedNumber, part);
  };

  const onNotification = (method: string, params: unknown): void => {
    if (method !== 'reply') return;
    const parsed = ReplyParams.safeParse(params);
    if (!parsed.success || parsed.data.body !== BODY.id) return;
    const reply = parsed.data;
    if ('done' in reply && reply.done) sending = sending.then(() => flush(reply.turn));
    else if ('delta' in reply) {
      const parts = buffers.get(reply.turn) ?? [];
      parts.push(reply.delta);
      buffers.set(reply.turn, parts);
    }
  };

  const client = new BrainClient({
    addr: config.brainAddr,
    body: BODY,
    tools: () => [],
    openSocket,
    onNotification,
    onUse: () => Promise.reject(new Error('the WhatsApp body has no tools')),
    onStatus: (status) => log(`whatsapp: brain ${status}`),
    onResync: () => buffers.clear(),
  });

  const onInbound = (m: Inbound): void => {
    window.touch();
    client.say({ text: m.text, context: CONTEXT }).catch(() => {
      // Nothing goes to the phone: the person simply sees no answer, as with a brain that is down.
      log('whatsapp: the brain is not reachable, message not delivered');
    });
  };

  const webhook = createWebhook({ config, onInbound, log });

  return {
    webhook,
    start: async () => client.start(),
    stop: async () => client.stop(),
  };
}
