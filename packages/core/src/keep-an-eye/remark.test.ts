/** Tests for remarks: parsing the model's reply and the call itself. */
import { describe, expect, it } from 'vitest';
import type { Pet, WindowEntry } from '@tagalong/protocol';
import { FakeBrainProvider } from '../providers';
import type { BrainProvider, BrainRequest, BrainResult } from '../providers';
import { REMARK_INSTRUCTIONS, composeRemark, parseRemark } from './remark';

const scout: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  model: 'claude-opus-5',
  providerId: 'anthropic',
  roleId: 'companion',
};

const window: WindowEntry = {
  id: 'w-1',
  processName: 'WindowsTerminal.exe',
  title: 'npm test - failed',
  state: 'foreground',
  browser: false,
};

function brain(reply: string | Error, stopReason: BrainResult['stopReason'] = 'end') {
  const asked: Pet[] = [];
  const requests: BrainRequest[] = [];
  const fake = new FakeBrainProvider({ text: '' });
  const provider: BrainProvider = {
    id: 'fake',
    capabilities: fake.capabilities,
    complete: (request) => {
      requests.push(request);
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve({
        text: reply,
        stopReason,
        usage: { inputTokens: 1, outputTokens: 1 },
      });
    },
  };
  return {
    asked,
    requests,
    resolve: (pet: Pet) => {
      asked.push(pet);
      return provider;
    },
  };
}

describe('parseRemark', () => {
  it.each(['NOTHING', 'nothing.', '  NOTHING\n', '', 'Nothing to say.'])(
    'reads "%s" as nothing to say',
    (raw) => {
      expect(parseRemark(raw)).toBeNull();
    },
  );

  it('keeps one short line, without quotes', () => {
    expect(parseRemark('"That test fails on a missing import."')).toEqual({
      text: 'That test fails on a missing import.',
    });
  });

  it('reads an offer from a second line', () => {
    expect(
      parseRemark(
        'That test fails on a missing import.\nOFFER: Add the missing import to parser.ts',
      ),
    ).toEqual({
      text: 'That test fails on a missing import.',
      offer: 'Add the missing import to parser.ts',
    });
  });

  it('refuses a ramble, markdown-ish emoji, or a line that is too long', () => {
    expect(parseRemark('word '.repeat(40))).toBeNull();
    expect(parseRemark('Nice work 🎉')).toBeNull();
    expect(parseRemark('x'.repeat(200))).toBeNull();
  });
});

describe('composeRemark', () => {
  it('asks once, with the window text as data, and returns the line', async () => {
    const { requests, resolve } = brain('That test fails on a missing import.');
    const remark = await composeRemark({
      pet: scout,
      summarizer: null,
      provider: resolve,
      window,
      text: 'FAIL src/parser.test.ts\nCannot find module ./lexer',
    });
    expect(remark).toEqual({ text: 'That test fails on a missing import.' });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.system).toBe(REMARK_INSTRUCTIONS);
    expect(REMARK_INSTRUCTIONS).toContain('NOTHING');
    const sent = JSON.stringify(requests[0]!.messages);
    expect(sent).toContain('npm test - failed');
    expect(sent).toContain('Cannot find module ./lexer');
    expect(requests[0]!.tools ?? []).toHaveLength(0);
  });

  it('runs on the summaries model when one is chosen', async () => {
    const { asked, resolve } = brain('NOTHING');
    await composeRemark({
      pet: scout,
      summarizer: { providerId: 'openrouter', model: 'small' },
      provider: resolve,
      window,
      text: 'ok',
    });
    expect(asked[0]).toMatchObject({ providerId: 'openrouter', model: 'small' });
  });

  it('falls back to the pet’s own brain', async () => {
    const { asked, resolve } = brain('NOTHING');
    await composeRemark({ pet: scout, summarizer: null, provider: resolve, window, text: 'ok' });
    expect(asked[0]).toMatchObject({ providerId: 'anthropic', model: 'claude-opus-5' });
  });

  it('says nothing when the brain fails or stops early', async () => {
    const failed = brain(new Error('offline'));
    expect(
      await composeRemark({
        pet: scout,
        summarizer: null,
        provider: failed.resolve,
        window,
        text: '',
      }),
    ).toBeNull();
    const cut = brain('That test fails', 'max_tokens');
    expect(
      await composeRemark({
        pet: scout,
        summarizer: null,
        provider: cut.resolve,
        window,
        text: '',
      }),
    ).toBeNull();
  });
});
