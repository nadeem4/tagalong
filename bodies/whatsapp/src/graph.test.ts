/** Tests for the Graph send on a fake fetch: the wire shape, one retry, and no secrets in logs. */
import { describe, expect, test } from 'vitest';
import { GRAPH_VERSION, createGraph } from './graph';

type Call = { url: string; init: RequestInit };

function fakeFetch(statuses: (number | Error)[]) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = statuses.shift() ?? 200;
    if (next instanceof Error) throw next;
    return new Response('{}', { status: next });
  }) as typeof fetch;
  return { fn, calls };
}

describe('sendText', () => {
  test('test_send_posts_the_documented_body_and_bearer', async () => {
    const { fn, calls } = fakeFetch([200]);
    const graph = createGraph({ phoneNumberId: '1234', accessToken: 'tok-secret', fetch: fn });
    await graph.sendText('15550001111', 'hello');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://graph.facebook.com/${GRAPH_VERSION}/1234/messages`);
    expect(calls[0]?.init.method).toBe('POST');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-secret');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      messaging_product: 'whatsapp',
      to: '15550001111',
      type: 'text',
      text: { body: 'hello' },
    });
  });

  test('test_one_retry_on_a_server_error_then_gives_up_quietly', async () => {
    const { fn, calls } = fakeFetch([503, 500]);
    const logs: string[] = [];
    const graph = createGraph({
      phoneNumberId: '1',
      accessToken: 't',
      fetch: fn,
      log: (l) => logs.push(l),
    });
    await expect(graph.sendText('1', 'x')).resolves.toBe(false);
    expect(calls).toHaveLength(2);
    expect(logs).toHaveLength(1);
  });

  test('test_a_network_error_is_retried_once_and_can_succeed', async () => {
    const { fn, calls } = fakeFetch([new Error('reset'), 200]);
    const logs: string[] = [];
    const graph = createGraph({
      phoneNumberId: '1',
      accessToken: 't',
      fetch: fn,
      log: (l) => logs.push(l),
    });
    await graph.sendText('1', 'x');
    expect(calls).toHaveLength(2);
    expect(logs).toEqual([]);
  });

  test('test_the_token_and_text_are_never_logged', async () => {
    const { fn } = fakeFetch([new Error('boom tok-secret'), 400]);
    const logs: string[] = [];
    const graph = createGraph({
      phoneNumberId: '1',
      accessToken: 'tok-secret',
      fetch: fn,
      log: (l) => logs.push(l),
    });
    await graph.sendText('1', 'my private words');
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain('tok-secret');
      expect(line).not.toContain('my private words');
    }
  });
});

describe('sendButtons', () => {
  test('test_send_buttons_posts_the_interactive_body', async () => {
    const { fn, calls } = fakeFetch([200]);
    const graph = createGraph({ phoneNumberId: '1234', accessToken: 'tok', fetch: fn });
    await graph.sendButtons('15550001111', 'Run it?', [
      { id: 'ask:a1:0', title: 'allow' },
      { id: 'ask:a1:1', title: 'deny' },
    ]);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      messaging_product: 'whatsapp',
      to: '15550001111',
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Run it?' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'ask:a1:0', title: 'allow' } },
            { type: 'reply', reply: { id: 'ask:a1:1', title: 'deny' } },
          ],
        },
      },
    });
  });

  test('test_send_buttons_retries_once_and_fails_quietly', async () => {
    const { fn, calls } = fakeFetch([503, 500]);
    const logs: string[] = [];
    const graph = createGraph({
      phoneNumberId: '1',
      accessToken: 't',
      fetch: fn,
      log: (l) => logs.push(l),
    });
    await expect(graph.sendButtons('1', 'q', [{ id: 'a', title: 'b' }])).resolves.toBe(false);
    expect(calls).toHaveLength(2);
    expect(logs).toHaveLength(1);
  });

  test('test_a_send_says_whether_it_went', async () => {
    const ok = createGraph({ phoneNumberId: '1', accessToken: 't', fetch: fakeFetch([200]).fn });
    expect(await ok.sendText('1', 'x')).toBe(true);
    const bad = createGraph({ phoneNumberId: '1', accessToken: 't', fetch: fakeFetch([400]).fn });
    expect(await bad.sendText('1', 'x')).toBe(false);
  });
});
