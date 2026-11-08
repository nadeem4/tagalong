/**
 * The one public door: Meta's signed webhook on /webhook. A request counts only if the HMAC
 * of its raw body checks out, and only text and button taps from the one allowed number reach the bridge.
 * Everything else gets a quick, boring answer, so a stranger learns nothing and Meta never
 * retries a message we chose to ignore.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { WhatsAppConfig } from './config';

export type Inbound =
  { kind: 'text'; id: string; text: string } | { kind: 'button'; id: string; buttonId: string };

export interface WebhookOptions {
  config: Pick<WhatsAppConfig, 'appSecret' | 'verifyToken' | 'allowedNumber'>;
  onInbound: (m: Inbound) => void;
  maxBodyBytes?: number;
  log?: (line: string) => void;
}

const DEFAULT_MAX_BODY = 1_000_000;
const SEEN_LIMIT = 1000;

function validSignature(secret: string, raw: Buffer, header: string | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
  return safeEqual(header, expected.toString());
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  // timingSafeEqual throws on unequal lengths.
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Numbers arrive as digits only; the person may have typed "+1 (555) ...". */
const digits = (s: string): string => s.replace(/\D/g, '');

/** Reads the raw body; 'over' past the cap, 'error' when the socket failed. */
function readBody(req: IncomingMessage, max: number): Promise<Buffer | 'over' | 'error'> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > max) {
        over = true;
        chunks.length = 0;
        resolve('over');
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => !over && resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve('error'));
  });
}

interface WebhookMessage {
  id?: unknown;
  from?: unknown;
  type?: unknown;
  text?: { body?: unknown };
  interactive?: { button_reply?: { id?: unknown } };
}

function textMessages(body: unknown): WebhookMessage[] {
  const out: WebhookMessage[] = [];
  const entries = (body as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const messages = (change as { value?: { messages?: unknown } })?.value?.messages;
      if (Array.isArray(messages)) out.push(...(messages as WebhookMessage[]));
    }
  }
  return out;
}

export function createWebhook(options: WebhookOptions): Server {
  const { config, onInbound, maxBodyBytes = DEFAULT_MAX_BODY, log = () => undefined } = options;
  const seen = new Set<string>();

  const remember = (id: string): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as string);
    return true;
  };

  const verify = (url: URL, res: ServerResponse): void => {
    const ok =
      url.searchParams.get('hub.mode') === 'subscribe' &&
      safeEqual(url.searchParams.get('hub.verify_token') ?? '', config.verifyToken);
    if (!ok) return void res.writeHead(403).end();
    res
      .writeHead(200, { 'content-type': 'text/plain' })
      .end(url.searchParams.get('hub.challenge') ?? '');
  };

  const receive = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const raw = await readBody(req, maxBodyBytes);
    if (raw === 'error') return void res.destroy();
    if (raw === 'over') {
      // Stop a sender that keeps streaming past the cap once the refusal is out.
      res.on('finish', () => req.destroy());
      return void res.writeHead(413, { connection: 'close' }).end();
    }
    // The signature is checked on the raw bytes before anything is parsed.
    if (!validSignature(config.appSecret, raw, req.headers['x-hub-signature-256'] as string)) {
      return void res.writeHead(401).end();
    }
    // Answer at once: Meta retries a slow webhook, and we have nothing more to say.
    res.writeHead(200).end();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      return log('webhook: signed body was not JSON');
    }
    for (const m of textMessages(parsed)) {
      if (typeof m.id !== 'string' || typeof m.from !== 'string') continue;
      if (digits(m.from) !== digits(config.allowedNumber)) continue;
      if (m.type === 'text') {
        const body = m.text?.body;
        if (typeof body === 'string' && remember(m.id)) {
          onInbound({ kind: 'text', id: m.id, text: body });
        }
      } else if (m.type === 'interactive') {
        const buttonId = m.interactive?.button_reply?.id;
        if (typeof buttonId === 'string' && remember(m.id)) {
          onInbound({ kind: 'button', id: m.id, buttonId });
        }
      }
    }
  };

  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/webhook') return void res.writeHead(404).end();
    if (req.method === 'GET') return verify(url, res);
    if (req.method === 'POST') {
      void receive(req, res).catch(() => res.headersSent || res.writeHead(500).end());
      return;
    }
    res.writeHead(405).end();
  });
}
