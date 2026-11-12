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
  /** Wait before the brain socket is redialled; the tests use a few milliseconds. */
  retryMs?: number;
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
  const desk = new AskDesk();
  // Reply text per turn, held until that turn's `done`.
  const buffers = new Map<string, string[]>();

  // One chain for all sends, so parts of two turns never interleave.
  let sending: Promise<void> = Promise.resolve();

  // Replies sent to the phone so far. An ask remembers the count when it was shown; typed text
  // may answer it only while no reply has come after (a later "yes" is about the chat).
  let replies = 0;
  // Every phone send goes through the one chain, so nothing lands between the parts of a reply.
  const enqueue = (task: () => Promise<void>): void => {
    // A throwing task must not break the chain, or every later send would be lost.
    sending = sending.then(task).catch((e: unknown) => {
      log(`whatsapp: a send task failed (${e instanceof Error ? e.name : 'error'})`);
    });
  };
  // The bridge only reports what happened; Scout words any reply, so it has no canned lines.
  const tell = (name: string, data: Record<string, unknown>): void => {
    if (!client.event(name, data)) log(`whatsapp: the brain is not reachable, ${name} not sent`);
  };

  const flush = async (turn: string): Promise<void> => {
    const text = (buffers.get(turn) ?? []).join('');
    buffers.delete(turn);
    if (!window.isOpen()) {
      // Free text after 24 hours is refused by WhatsApp; the desktop chat still has it.
      log('whatsapp: reply dropped, the 24-hour window is closed');
      return;
    }
    const parts = splitReply(text);
    if (parts.length > 0) replies += 1;
    for (const part of parts) await graph.sendText(config.allowedNumber, part);
  };

  const showAsk = async (ask: Extract<AskParams, { state: 'open' }>): Promise<void> => {
    // Outside the window nothing can be sent, so the desk must not hold an ask the person
    // never saw (a typed yes would answer it unseen). It stays open on the other bodies.
    if (!window.isOpen()) return;
    const out = desk.open(ask, replies);
    if (!out) return;
    let sent = true;
    if (out.kind === 'buttons') {
      sent = await graph.sendButtons(config.allowedNumber, out.body, out.buttons);
    } else {
      for (const part of splitReply(out.body)) {
        sent = (await graph.sendText(config.allowedNumber, part)) && sent;
      }
    }
    // An ask the person may not have seen must never be answerable.
    if (!sent) desk.close(ask.id);
  };

  const onAsk = (params: unknown): void => {
    const parsed = AskParams.safeParse(params);
    if (!parsed.success) return;
    const ask = parsed.data;
    // Queued like every send, so an ask and a close keep their order with replies.
    if (ask.state === 'closed') enqueue(async () => desk.close(ask.id));
    else enqueue(() => showAsk(ask));
  };

  const onNotification = (method: string, params: unknown): void => {
    if (method === 'ask') return onAsk(params);
    if (method !== 'reply') return;
    const parsed = ReplyParams.safeParse(params);
    if (!parsed.success || parsed.data.body !== BODY.id) return;
    const reply = parsed.data;
    if ('done' in reply && reply.done) enqueue(() => flush(reply.turn));
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
    ...(deps.retryMs === undefined ? {} : { retryMs: deps.retryMs }),
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
        tell('ask_closed', { via: 'answer' });
      } else log('whatsapp: the brain is not reachable, answer not delivered');
    });
  };

  const onInbound = (m: Inbound): void => {
    // A tap is the person writing too, so it keeps the 24-hour window open.
    window.touch();
    if (m.kind === 'button') {
      const tapped = desk.fromButton(m.buttonId);
      if ('closed' in tapped) tell('ask_closed', { via: 'tap' });
      else answer(tapped);
      return;
    }
    const typed = desk.fromText(m.text, replies);
    if (typed === null) say(m.text);
    else if ('ambiguous' in typed) tell('many_pending', { asks: desk.ids().length });
    else answer(typed);
  };

  const webhook = createWebhook({ config, onInbound, log });

  return {
    webhook,
    start: async () => client.start(),
    stop: async () => client.stop(),
  };
}
