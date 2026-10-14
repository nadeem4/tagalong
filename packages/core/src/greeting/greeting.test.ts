import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import { BrainError, FakeBrainProvider } from '../providers';
import type { BrainProvider, BrainRequest } from '../providers';
import { composeGreeting, fallbackGreeting } from './greeting';
import type { GreetingContext } from './greeting';

const scout: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  notes: 'You are Scout.',
  model: 'sonnet',
  visionModel: 'sonnet-vision',
  providerId: 'claude-code',
  roleId: 'companion',
  toolGrants: {},
  replyStyle: 'text',
};

/** Local times, so the time of day reads the same wherever the test runs. */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);

const morning: GreetingContext = { now: at(13, 9, 14), awaySince: at(13, 8), handoffs: [] };

function brain(reply: string | Error) {
  const asked: { providerId: string; model: string; visionModel?: string }[] = [];
  const requests: BrainRequest[] = [];
  const fake = new FakeBrainProvider({ text: typeof reply === 'string' ? reply : '' });
  const provider: BrainProvider = {
    id: 'fake',
    capabilities: fake.capabilities,
    listModels: () => fake.listModels(),
    complete: (req, events, signal) => {
      requests.push(req);
      if (reply instanceof Error) return Promise.reject(reply);
      return fake.complete(req, events, signal);
    },
  };
  return {
    asked,
    requests,
    resolve: (pet: Pet) => {
      asked.push({
        providerId: pet.providerId,
        model: pet.model,
        ...(pet.visionModel === undefined ? {} : { visionModel: pet.visionModel }),
      });
      return provider;
    },
  };
}

describe('fallbackGreeting', () => {
  it('greets for the time of day when you were not away long', () => {
    expect(fallbackGreeting(morning)).toBe('Morning. I’m here when you need me.');
    expect(fallbackGreeting({ ...morning, now: at(13, 14) })).toBe(
      'Afternoon. I’m here when you need me.',
    );
    expect(fallbackGreeting({ ...morning, now: at(13, 19) })).toBe(
      'Evening. I’m here when you need me.',
    );
    expect(fallbackGreeting({ ...morning, now: at(13, 23, 30) })).toBe(
      'Working late? I’m here when you need me.',
    );
  });

  it('greets for the time of day when it never saw you open it before', () => {
    expect(fallbackGreeting({ ...morning, awaySince: null })).toBe(
      'Morning. I’m here when you need me.',
    );
  });

  it('says how long you were away, in days', () => {
    expect(fallbackGreeting({ ...morning, awaySince: at(10, 9) })).toBe(
      'Back after 3 days. Nothing waiting for you.',
    );
    expect(fallbackGreeting({ ...morning, awaySince: at(12, 8) })).toBe(
      'Back after a day. Nothing waiting for you.',
    );
  });

  it('greets you by name when you gave one', () => {
    const named = { ...morning, userName: 'Nadeem' };
    expect(fallbackGreeting(named)).toBe('Morning, Nadeem. I’m here when you need me.');
    expect(fallbackGreeting({ ...named, now: at(13, 23, 30) })).toBe(
      'Working late, Nadeem? I’m here when you need me.',
    );
    expect(fallbackGreeting({ ...named, awaySince: at(10, 9) })).toBe(
      'Back after 3 days, Nadeem. Nothing waiting for you.',
    );
    expect(fallbackGreeting({ ...morning, userName: '' })).toBe(
      'Morning. I’m here when you need me.',
    );
  });

  it('mentions a hand-off that finished while you were away', () => {
    const one = [{ expertName: 'Claude Code', text: 'Fix the failing test' }];
    expect(fallbackGreeting({ ...morning, handoffs: one })).toBe(
      'Morning. Claude Code finished what you handed over.',
    );
    expect(fallbackGreeting({ ...morning, awaySince: at(10, 9), handoffs: one })).toBe(
      'Back after 3 days. Claude Code finished what you handed over.',
    );
    expect(fallbackGreeting({ ...morning, handoffs: [...one, ...one] })).toBe(
      'Morning. 2 hand-offs finished while you were away.',
    );
  });
});

describe('composeGreeting', () => {
  it('asks the summaries model for one short line, with only the facts it may use', async () => {
    const b = brain('Morning. Claude Code fixed that failing test while you were out.');
    const result = await composeGreeting({
      pet: scout,
      summarizer: { providerId: 'anthropic', model: 'claude-haiku' },
      provider: b.resolve,
      context: { ...morning, handoffs: [{ expertName: 'Claude Code', text: 'Fix the test' }] },
    });

    expect(result).toEqual({
      text: 'Morning. Claude Code fixed that failing test while you were out.',
      source: 'model',
    });
    expect(b.asked).toEqual([{ providerId: 'anthropic', model: 'claude-haiku' }]);
    const request = b.requests[0]!;
    expect(request.model).toBe('claude-haiku');
    expect(request.maxTokens).toBeLessThanOrEqual(80);
    expect(request.system).toMatch(/one sentence/i);
    expect(request.system).toMatch(/under 20 words/i);
    expect(request.system).toMatch(/no emoji/i);
    expect(request.system).toMatch(/never invent/i);
    const facts = JSON.stringify(request.messages);
    expect(facts).toContain('morning');
    expect(facts).toContain('Claude Code');
    expect(facts).toContain('Fix the test');
  });

  it('gives the model the person’s name only when one is set', async () => {
    const named = brain('Morning, Nadeem.');
    await composeGreeting({
      pet: scout,
      summarizer: null,
      provider: named.resolve,
      context: { ...morning, userName: 'Nadeem' },
    });
    expect(JSON.stringify(named.requests[0]!.messages)).toContain('The person’s name: Nadeem.');

    const unnamed = brain('Morning.');
    await composeGreeting({
      pet: scout,
      summarizer: null,
      provider: unnamed.resolve,
      context: morning,
    });
    expect(JSON.stringify(unnamed.requests[0]!.messages)).not.toContain('name');
  });

  it('falls back to a line with the name when the brain fails', async () => {
    const result = await composeGreeting({
      pet: scout,
      summarizer: null,
      provider: brain(new BrainError('auth', 'no key')).resolve,
      context: { ...morning, userName: 'Nadeem' },
    });
    expect(result).toEqual({
      text: 'Morning, Nadeem. I’m here when you need me.',
      source: 'fallback',
    });
  });

  it('uses the pet’s own brain, text only, when no summaries model is chosen', async () => {
    const b = brain('Morning. Here when you need me.');
    await composeGreeting({ pet: scout, summarizer: null, provider: b.resolve, context: morning });
    expect(b.asked).toEqual([{ providerId: 'claude-code', model: 'sonnet' }]);
  });

  it('trims quotes and keeps the first line', async () => {
    const b = brain('"Morning, nice to see you."\nAnything else?');
    const result = await composeGreeting({
      pet: scout,
      summarizer: null,
      provider: b.resolve,
      context: morning,
    });
    expect(result.text).toBe('Morning, nice to see you.');
  });

  it.each([
    ['the brain fails', new BrainError('auth', 'no key')],
    ['the reply is empty', '   '],
    ['the reply is too long', 'word '.repeat(40).trim()],
    ['the reply has an emoji', 'Morning! 👋'],
  ])('falls back to a handwritten line when %s', async (_why, reply) => {
    const result = await composeGreeting({
      pet: scout,
      summarizer: null,
      provider: brain(reply).resolve,
      context: morning,
    });
    expect(result).toEqual({ text: 'Morning. I’m here when you need me.', source: 'fallback' });
  });

  it('falls back when the provider cannot even be built', async () => {
    const result = await composeGreeting({
      pet: scout,
      summarizer: null,
      provider: () => {
        throw new Error('no key for anthropic');
      },
      context: morning,
    });
    expect(result.source).toBe('fallback');
  });

  it('falls back when the brain takes too long', async () => {
    const slow: BrainProvider = {
      id: 'slow',
      capabilities: { vision: false, tools: false, streaming: true },
      listModels: () => Promise.resolve([]),
      complete: (_req, _events, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () =>
            resolve({
              text: '',
              stopReason: 'aborted',
              usage: { inputTokens: 0, outputTokens: 0 },
            }),
          );
        }),
    };
    const result = await composeGreeting({
      pet: scout,
      summarizer: null,
      provider: () => slow,
      context: morning,
      timeoutMs: 10,
    });
    expect(result.source).toBe('fallback');
  });
});
