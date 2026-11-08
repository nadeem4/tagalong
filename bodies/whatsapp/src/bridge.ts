/**
 * The WhatsApp body: a contract v1 client that turns the one allowed sender's texts into
 * `say`, buffers Scout's `reply` until `done`, and sends the finished text back through the
 * Graph API while the 24-hour window is open. It has no tools and shows no display, so the
 * brain treats it as a plain chat body. Permission asks are shown as reply buttons or a
 * numbered list, and a tap or a typed yes answers them exactly like a yes at the desk.
 */
import type { Server } from 'node:http';
import {
  AskParams,
  BrainClient,
  ErrorCode,
  ReplyParams,
  RpcError,
  type BrainClientOptions,
} from '@tagalong/contract';
import { AskDesk, type Answer } from './asks';
import type { WhatsAppConfig } from './config';
import { createGraph } from './graph';
import { splitReply } from './split';
import { createWebhook, type Inbound } from './webhook';
import { Window } from './window';

export const BODY = { id: 'whatsapp', kind: 'whatsapp', name: 'WhatsApp' } as const;
export const CONTEXT = {
  channel: 'whatsapp',
  note: 'text chat on a phone; keep replies short and offer detail on request',
} as const;

// The bridge's only own words besides the cut note; everything else is Scout's.
const CLOSED_LINE = 'That question is closed.';
const MANY_LINE = 'More than one question is open: please tap a button';

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
  const window = new Window(now);
  const graph = createGraph({
    phoneNumberId: config.phoneNumberId,
    accessToken: config.accessToken,
    log,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  const desk = new AskDesk();
  // Reply text per turn, held until that turn's `done`.
  const buffers = new Map<string, string[]>();

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

  const onAsk = (params: unknown): void => {
    const parsed = AskParams.safeParse(params);
    if (!parsed.success) return;
    const ask = parsed.data;
    if (ask.state === 'closed') return desk.close(ask.id);
    // Outside the window nothing can be sent, so the desk must not hold an ask the person
    // never saw (a typed yes would answer it unseen). It stays open on the other bodies.
    if (!window.isOpen()) return;
    const out = desk.open(ask);
    if (!out) return;
    if (out.kind === 'buttons') void graph.sendButtons(config.allowedNumber, out.body, out.buttons);
    else void graph.sendText(config.allowedNumber, out.body);
  };

  const onNotification = (method: string, params: unknown): void => {
    if (method === 'ask') return onAsk(params);
    if (method !== 'reply') return;
    const parsed = ReplyParams.safeParse(params);
    if (!parsed.success || parsed.data.body !== BODY.id) return;
    const reply = parsed.data;
    if ('done' in reply && reply.done) void flush(reply.turn);
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
    onResync: () => {
      buffers.clear();
      // The brain re-sends the asks it still holds after a resync.
      desk.clear();
    },
  });

  const say = (text: string): void => {
    client.say({ text, context: CONTEXT }).catch(() => {
      // Nothing goes to the phone: the person simply sees no answer, as with a brain that is down.
      log('whatsapp: the brain is not reachable, message not delivered');
    });
  };

  const answer = (a: Answer): void => {
    client.answerWith(a.ask, a.option, a.text).catch((err: unknown) => {
      if (err instanceof RpcError && err.code === ErrorCode.not_found) {
        desk.close(a.ask);
        void graph.sendText(config.allowedNumber, CLOSED_LINE);
      } else log('whatsapp: the brain is not reachable, answer not delivered');
    });
  };

  const onInbound = (m: Inbound): void => {
    // A tap is the person writing too, so it keeps the 24-hour window open.
    window.touch();
    if (m.kind === 'button') {
      const tapped = desk.fromButton(m.buttonId);
      if ('closed' in tapped) void graph.sendText(config.allowedNumber, CLOSED_LINE);
      else answer(tapped);
      return;
    }
    const typed = desk.fromText(m.text);
    if (typed === null) say(m.text);
    else if ('ambiguous' in typed) void graph.sendText(config.allowedNumber, MANY_LINE);
    else answer(typed);
  };

  const webhook = createWebhook({ config, onInbound, log });

  return {
    webhook,
    start: async () => client.start(),
    stop: async () => client.stop(),
  };
}
