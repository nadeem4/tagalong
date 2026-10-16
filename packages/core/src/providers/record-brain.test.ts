/** Tests for recordBrain: one sight-log row per call, counts only, even when the call fails. */
import { describe, expect, it } from 'vitest';
import type { SightRow } from '../memory/sight-log';
import type { BrainEvents, BrainProvider, BrainRequest } from './brain';
import { FakeBrainProvider } from './fake';
import { recordBrain } from './record-brain';

const IMAGE = { type: 'image', mime: 'image/png', base64: 'iVBORw0KGgoPIXELS' } as const;

function recorder() {
  const rows: SightRow[] = [];
  return { rows, log: { record: (row: SightRow) => void rows.push(row) } };
}

const REQUEST: BrainRequest = {
  model: 'haiku',
  system: 'You are Scout.', // 14 characters
  maxTokens: 100,
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'what is on my screen?' }, IMAGE] }, // 21
  ],
};

const EVENTS: BrainEvents = {
  onText: () => {},
  onToolUse: async () => ({ content: [{ type: 'text', text: 'window text' }, IMAGE] }), // 11
};

describe('recordBrain', () => {
  it('writes one row per call with the brain, the characters and the pictures sent', async () => {
    const { rows, log } = recorder();
    const provider = recordBrain(new FakeBrainProvider({ text: 'ok' }), log);
    await provider.complete(REQUEST, EVENTS, new AbortController().signal);
    expect(rows).toEqual([
      { kind: 'sent_to_ai', providerId: 'fake', model: 'haiku', chars: 35, images: 1 },
    ]);
  });

  it('counts what a tool handed back to the model mid-call', async () => {
    const { rows, log } = recorder();
    const provider = recordBrain(
      new FakeBrainProvider({ text: 'ok', toolCall: { id: 't1', name: 'look', input: {} } }),
      log,
    );
    await provider.complete(REQUEST, EVENTS, new AbortController().signal);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ chars: 35 + 11, images: 2 });
  });

  it('counts the tool results already in the history it sends', async () => {
    const { rows, log } = recorder();
    const provider = recordBrain(new FakeBrainProvider({ text: 'ok' }), log);
    const history: BrainRequest = {
      ...REQUEST,
      messages: [
        ...REQUEST.messages,
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'look', input: {} }] },
        {
          role: 'user',
          content: [
            { type: 'tool_result', toolUseId: 't1', content: 'four' },
            {
              type: 'tool_result',
              toolUseId: 't2',
              content: [{ type: 'text', text: 'ab' }, IMAGE],
            },
          ],
        },
      ],
    };
    await provider.complete(history, EVENTS, new AbortController().signal);
    // 35 from the request, 4 and 2 from the two results, and the result's picture.
    expect(rows[0]).toMatchObject({ chars: 35 + 4 + 2, images: 2 });
  });

  it('never keeps the text or the pictures themselves', async () => {
    const { rows, log } = recorder();
    await recordBrain(new FakeBrainProvider({ text: 'ok' }), log).complete(
      REQUEST,
      EVENTS,
      new AbortController().signal,
    );
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain('what is on my screen');
    expect(stored).not.toContain('You are Scout');
    expect(stored).not.toContain('PIXELS');
  });

  it('still writes the row when the call fails, since the request already left', async () => {
    const { rows, log } = recorder();
    const failing: BrainProvider = {
      id: 'anthropic',
      capabilities: { vision: true, tools: true },
      complete: () => Promise.reject(new Error('overloaded')),
    };
    const provider = recordBrain(failing, log);
    await expect(provider.complete(REQUEST, EVENTS, new AbortController().signal)).rejects.toThrow(
      'overloaded',
    );
    expect(rows).toMatchObject([{ kind: 'sent_to_ai', providerId: 'anthropic' }]);
  });

  it('keeps the provider as it was', () => {
    const inner = new FakeBrainProvider({ text: 'ok' });
    const provider = recordBrain(inner, recorder().log);
    expect(provider.id).toBe(inner.id);
    expect(provider.capabilities).toEqual(inner.capabilities);
  });
});
