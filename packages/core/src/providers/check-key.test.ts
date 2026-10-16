/** Tests for checkKey: one brief request on the recommended model, and plain failure sentences. */
import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import { BrainError, FakeBrainProvider } from './index';
import type { BrainProvider, BrainRequest } from './index';
import { checkKey } from './check-key';

const base: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  notes: '',
  model: 'haiku',
  providerId: 'claude-code',
  roleId: 'companion',
  toolGrants: {},
  replyStyle: 'text',
};

function provider(fail?: Error) {
  const asked: { pet: Pet; req: BrainRequest }[] = [];
  const fake = new FakeBrainProvider({ text: 'OK' });
  return {
    asked,
    resolve: (pet: Pet): BrainProvider => ({
      id: 'fake',
      capabilities: fake.capabilities,
      complete: (req, events, signal) => {
        asked.push({ pet, req });
        return fail === undefined ? fake.complete(req, events, signal) : Promise.reject(fail);
      },
    }),
  };
}

describe('checkKey', () => {
  it('asks the service once, briefly, on its recommended model', async () => {
    const p = provider();
    expect(
      await checkKey({ resolve: p.resolve, base, providerId: 'openrouter', label: 'OpenRouter' }),
    ).toEqual({ ok: true });
    expect(p.asked).toHaveLength(1);
    expect(p.asked[0]!.pet.providerId).toBe('openrouter');
    expect(p.asked[0]!.req.maxTokens).toBe(16);
  });

  it('says plainly why a key failed', async () => {
    const refused = provider(new BrainError('auth', 'OpenRouter rejected the API key.'));
    expect(
      await checkKey({
        resolve: refused.resolve,
        base,
        providerId: 'openrouter',
        label: 'OpenRouter',
      }),
    ).toEqual({
      ok: false,
      message: 'OpenRouter turned that key down. Check it was copied whole, or make a new one.',
    });
    const offline = provider(new BrainError('connection', 'Could not reach OpenRouter.'));
    expect(
      await checkKey({
        resolve: offline.resolve,
        base,
        providerId: 'openrouter',
        label: 'OpenRouter',
      }),
    ).toEqual({
      ok: false,
      message: 'I couldn’t reach OpenRouter. Check your connection, then try again.',
    });
  });

  it('gives up on a service that does not answer', async () => {
    const deaf = {
      resolve: (): BrainProvider => ({
        id: 'deaf',
        capabilities: { vision: false, tools: false },
        complete: (_req, _events, signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      }),
    };
    const result = await checkKey({
      resolve: deaf.resolve,
      base,
      providerId: 'openrouter',
      label: 'OpenRouter',
      timeoutMs: 10,
    });
    expect(result.ok).toBe(false);
  });
});
