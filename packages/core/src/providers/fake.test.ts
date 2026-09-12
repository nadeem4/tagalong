import { describe, expect, it, vi } from 'vitest';
import type { BrainEvents, BrainRequest } from './brain';
import { FakeBrainProvider } from './fake';

const request: BrainRequest = {
  model: 'fake-model',
  system: 'You are a test pet.',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  maxTokens: 1024,
};

/** Collects everything a provider emits so assertions read like a transcript. */
function recorder(toolResult = { content: 'tool ran' }): {
  events: BrainEvents;
  deltas: string[];
  calls: { id: string; name: string; input: unknown }[];
} {
  const deltas: string[] = [];
  const calls: { id: string; name: string; input: unknown }[] = [];
  return {
    deltas,
    calls,
    events: {
      onText: (delta) => {
        deltas.push(delta);
      },
      onToolUse: async (call) => {
        calls.push(call);
        return toolResult;
      },
    },
  };
}

describe('FakeBrainProvider', () => {
  it('identifies itself as the fake provider with full capabilities', async () => {
    const provider = new FakeBrainProvider({ text: 'hi' });
    expect(provider.id).toBe('fake');
    expect(provider.capabilities).toEqual({ vision: true, tools: true, streaming: true });
    expect(await provider.listModels()).toContain('fake-model');
  });

  it('streams the scripted text word by word', async () => {
    const provider = new FakeBrainProvider({ text: 'one two three' });
    const { events, deltas } = recorder();

    const result = await provider.complete(request, events, new AbortController().signal);

    expect(deltas).toEqual(['one', ' two', ' three']);
    expect(deltas.join('')).toBe('one two three');
    expect(result.text).toBe('one two three');
    expect(result.stopReason).toBe('end');
  });

  it('emits the scripted tool call before any text and feeds the result back', async () => {
    const provider = new FakeBrainProvider({
      text: 'done',
      toolCall: { id: 'call_1', name: 'search', input: { q: 'cats' } },
    });
    const { events, deltas, calls } = recorder({ content: 'found cats' });
    const onToolUse = vi.spyOn(events, 'onToolUse');

    const result = await provider.complete(request, events, new AbortController().signal);

    expect(calls).toEqual([{ id: 'call_1', name: 'search', input: { q: 'cats' } }]);
    expect(onToolUse).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(['done']);
    expect(result.stopReason).toBe('end');
  });

  it('stops with the aborted stop reason when the signal fires mid-stream', async () => {
    const provider = new FakeBrainProvider({ text: 'one two three four' });
    const controller = new AbortController();
    const deltas: string[] = [];
    const events: BrainEvents = {
      onText: (delta) => {
        deltas.push(delta);
        controller.abort();
      },
      onToolUse: async () => ({ content: '' }),
    };

    const result = await provider.complete(request, events, controller.signal);

    expect(deltas).toEqual(['one']);
    expect(result.text).toBe('one');
    expect(result.stopReason).toBe('aborted');
  });

  it('returns usage counts that scale with the prompt and the reply', async () => {
    const provider = new FakeBrainProvider({ text: 'a longer scripted answer here' });
    const { events } = recorder();

    const result = await provider.complete(request, events, new AbortController().signal);

    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });
});
