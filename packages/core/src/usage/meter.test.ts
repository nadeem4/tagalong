/** Tests for meterBrain: each finished call recorded, counts only. */
import { describe, expect, it } from 'vitest';
import type { BrainProvider, BrainRequest } from '../providers/brain';
import { FakeBrainProvider } from '../providers/fake';
import { meterBrain } from './meter';
import type { MeteredCall } from './meter';

const request: BrainRequest = {
  model: 'fake-model',
  system: 'You are Scout.',
  maxTokens: 100,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello there' }] }],
};

function events(texts: string[] = [], tools: string[] = []) {
  return {
    onText: (delta: string) => texts.push(delta),
    onToolUse: async (call: { name: string }) => {
      tools.push(call.name);
      return { content: 'tool said this' };
    },
  };
}

describe('meterBrain', () => {
  it('records the provider, the model and the tokens of a call', async () => {
    const calls: MeteredCall[] = [];
    const metered = meterBrain(new FakeBrainProvider({ text: 'hi you' }), (c) => calls.push(c));
    const result = await metered.complete(request, events(), new AbortController().signal);
    expect(calls).toEqual([
      {
        providerId: 'fake',
        model: 'fake-model',
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      },
    ]);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  it('records what an aborted turn used before it stopped', async () => {
    const calls: MeteredCall[] = [];
    const metered = meterBrain(new FakeBrainProvider({ text: 'hi' }), (c) => calls.push(c));
    const abort = new AbortController();
    abort.abort();
    const result = await metered.complete(request, events(), abort.signal);
    expect(result.stopReason).toBe('aborted');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.inputTokens).toBeGreaterThan(0);
  });

  it('records nothing when the call throws, and the error still reaches the caller', async () => {
    const calls: MeteredCall[] = [];
    const failing: BrainProvider = {
      id: 'broken',
      capabilities: { vision: false, tools: true, streaming: true },
      listModels: async () => [],
      complete: () => Promise.reject(new Error('offline')),
    };
    await expect(
      meterBrain(failing, (c) => calls.push(c)).complete(
        request,
        events(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('offline');
    expect(calls).toEqual([]);
  });

  it('never fails a turn because the record could not be written', async () => {
    const metered = meterBrain(new FakeBrainProvider({ text: 'fine' }), () => {
      throw new Error('database closed');
    });
    const result = await metered.complete(request, events(), new AbortController().signal);
    expect(result.text).toBe('fine');
  });

  it('passes the stream, tool calls and the provider’s own facts through unchanged', async () => {
    const texts: string[] = [];
    const tools: string[] = [];
    const inner = new FakeBrainProvider({
      text: 'one two',
      toolCall: { id: 't1', name: 'read_window_text', input: {} },
    });
    const seeing: BrainProvider = Object.assign(inner, { canSee: (m: string) => m === 'v' });
    const calls: MeteredCall[] = [];
    const metered = meterBrain(seeing, (c) => calls.push(c));
    expect(metered.id).toBe('fake');
    expect(metered.capabilities).toEqual(inner.capabilities);
    expect(metered.canSee?.('v')).toBe(true);
    expect(metered.canSee?.('t')).toBe(false);
    const result = await metered.complete(
      request,
      events(texts, tools),
      new AbortController().signal,
    );
    expect(result.text).toBe('one two');
    expect(texts.join('')).toBe('one two');
    expect(tools).toEqual(['read_window_text']);
    // The tool loop runs inside one call, so it is one record with every round's tokens.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ inputTokens: result.usage.inputTokens });
  });
});
