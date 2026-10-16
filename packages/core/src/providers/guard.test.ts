/** Tests for guardBrain: secrets hidden in messages and tool results, everything else unchanged. */
import { describe, expect, it } from 'vitest';
import type { BrainEvents, BrainProvider, BrainRequest } from './brain';
import { guardBrain } from './guard';

const KEY = 'sk-' + 'ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

/** A provider that records what it was sent and runs one tool call. */
function recording() {
  const seen: { request?: BrainRequest; toolResult?: unknown } = {};
  const provider: BrainProvider = {
    id: 'recording',
    capabilities: { vision: true, tools: true },
    complete: async (request, events) => {
      seen.request = request;
      seen.toolResult = await events.onToolUse({ id: 't1', name: 'read_window_text', input: {} });
      return { text: 'ok', stopReason: 'end', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
  return { provider, seen };
}

const EVENTS: BrainEvents = {
  onText: () => {},
  onToolUse: async () => ({ content: [{ type: 'text', text: `API_KEY=${KEY}` }] }),
};

describe('guardBrain', () => {
  it('hides secrets in what is sent, the messages and the tool results alike', async () => {
    const { provider, seen } = recording();
    await guardBrain(provider).complete(
      {
        model: 'm',
        system: 'You are Scout.',
        maxTokens: 100,
        messages: [
          { role: 'user', content: [{ type: 'text', text: `why does ${KEY} fail?` }] },
          {
            role: 'user',
            content: [{ type: 'tool_result', toolUseId: 't0', content: `token ${KEY}` }],
          },
        ],
      },
      EVENTS,
      new AbortController().signal,
    );

    const sent = JSON.stringify(seen.request) + JSON.stringify(seen.toolResult);
    expect(sent).not.toContain(KEY);
    expect(sent).toContain('[hidden: API key]');
  });

  it('keeps everything else as it was: images, ids and the provider itself', async () => {
    const { provider, seen } = recording();
    const guarded = guardBrain(provider);
    expect(guarded.id).toBe('recording');
    expect(guarded.capabilities).toEqual(provider.capabilities);

    const image = { type: 'image', mime: 'image/png', base64: 'iVBORw0KGgo' } as const;
    await guarded.complete(
      { model: 'm', system: '', maxTokens: 1, messages: [{ role: 'user', content: [image] }] },
      EVENTS,
      new AbortController().signal,
    );
    expect(seen.request?.messages[0]?.content[0]).toEqual(image);
  });
});
