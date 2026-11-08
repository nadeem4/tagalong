/**
 * Tests for the signed webhook, run against a real local server with signed fake requests.
 * No Meta call is made; the "Meta side" is the helper that signs and posts a payload.
 */
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import { createWebhook, type Inbound } from './webhook';

const CONFIG = { appSecret: 'app-secret', verifyToken: 'verify-me', allowedNumber: '15550001111' };
const servers: Server[] = [];

async function start(maxBodyBytes?: number) {
  const inbound: Inbound[] = [];
  const server = createWebhook({
    config: CONFIG,
    onInbound: (m) => inbound.push(m),
    ...(maxBodyBytes === undefined ? {} : { maxBodyBytes }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, inbound };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

const sign = (body: string, secret = CONFIG.appSecret) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

function payload(messages: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    entry: [{ changes: [{ value: { messages, ...extra } }] }],
  });
}
const text = (id: string, from = CONFIG.allowedNumber, body = 'hi') => ({
  id,
  from,
  type: 'text',
  text: { body },
});

function post(base: string, body: string, signature: string | null = sign(body)) {
  return fetch(`${base}/webhook`, {
    method: 'POST',
    headers: signature === null ? {} : { 'x-hub-signature-256': signature },
    body,
  });
}

describe('GET /webhook', () => {
  test('test_verify_echoes_the_challenge', async () => {
    const { base } = await start();
    const res = await fetch(
      `${base}/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123`,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('abc123');
  });

  test('test_verify_with_the_wrong_token_is_403', async () => {
    const { base } = await start();
    const res = await fetch(
      `${base}/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc123`,
    );
    expect(res.status).toBe(403);
  });
});

describe('POST /webhook', () => {
  test('test_bad_signature_is_401_before_parsing', async () => {
    const { base, inbound } = await start();
    const res = await post(base, 'this is not json', sign('this is not json', 'wrong'));
    expect(res.status).toBe(401);
    expect(inbound).toEqual([]);
  });

  test('test_missing_signature_is_401', async () => {
    const { base, inbound } = await start();
    const res = await post(base, payload([text('m1')]), null);
    expect(res.status).toBe(401);
    expect(inbound).toEqual([]);
  });

  test('test_text_from_the_allowed_sender_reaches_onInbound', async () => {
    const { base, inbound } = await start();
    const res = await post(base, payload([text('m1', CONFIG.allowedNumber, 'hello Scout')]));
    expect(res.status).toBe(200);
    expect(inbound).toEqual([{ kind: 'text', id: 'm1', text: 'hello Scout' }]);
  });

  test('test_other_sender_is_dropped_with_200', async () => {
    const { base, inbound } = await start();
    const res = await post(base, payload([text('m1', '15559998888')]));
    expect(res.status).toBe(200);
    expect(inbound).toEqual([]);
  });

  test('test_repeated_message_id_is_ignored', async () => {
    const { base, inbound } = await start();
    await post(base, payload([text('m1')]));
    await post(base, payload([text('m1')]));
    expect(inbound).toHaveLength(1);
  });

  test('test_statuses_and_non_text_messages_are_ignored', async () => {
    const { base, inbound } = await start();
    const body = payload([{ id: 'm2', from: CONFIG.allowedNumber, type: 'audio' }], {
      statuses: [{ id: 'm1', status: 'delivered' }],
    });
    const res = await post(base, body);
    expect(res.status).toBe(200);
    expect(inbound).toEqual([]);
  });

  test('test_body_over_the_cap_is_413', async () => {
    const { base, inbound } = await start(100);
    const res = await post(base, payload([text('m1', CONFIG.allowedNumber, 'x'.repeat(500))]));
    expect(res.status).toBe(413);
    expect(inbound).toEqual([]);
  });
});

describe('button taps', () => {
  const tap = (id: string, from = CONFIG.allowedNumber, buttonId = 'ask:a1:0') => ({
    id,
    from,
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'allow' } },
  });

  test('test_a_button_tap_from_the_allowed_sender_reaches_onInbound', async () => {
    const { base, inbound } = await start();
    await post(base, payload([tap('m1')]));
    await post(base, payload([tap('m1')]));
    expect(inbound).toEqual([{ kind: 'button', id: 'm1', buttonId: 'ask:a1:0' }]);
  });

  test('test_a_button_tap_from_another_sender_is_dropped', async () => {
    const { base, inbound } = await start();
    const res = await post(base, payload([tap('m1', '15559999999')]));
    expect(res.status).toBe(200);
    expect(inbound).toEqual([]);
  });

  test('test_a_malformed_tap_is_ignored', async () => {
    const { base, inbound } = await start();
    await post(base, payload([{ id: 'm1', from: CONFIG.allowedNumber, type: 'interactive' }]));
    expect(inbound).toEqual([]);
  });
});

test('test_only_the_webhook_path_exists', async () => {
  const { base } = await start();
  expect((await fetch(`${base}/`)).status).toBe(404);
  expect((await fetch(`${base}/other`, { method: 'POST', body: '{}' })).status).toBe(404);
});
