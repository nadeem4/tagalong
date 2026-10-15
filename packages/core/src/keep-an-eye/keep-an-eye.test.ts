import { describe, expect, it } from 'vitest';
import { Expert, Settings } from '@tagalong/protocol';
import type { Brief, Pet, PetMoodParams, PetRemarkParams, WindowEntry } from '@tagalong/protocol';
import { FakeBrainProvider } from '../providers';
import type { BrainProvider, BrainRequest } from '../providers';
import type { PerceptionHost } from '../perception';
import { KeepAnEye } from './keep-an-eye';
import { COOLDOWN_MS, NOT_NOW_MS, SETTLE_MS } from './lookout';

const scout: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  model: 'claude-opus-5',
  providerId: 'anthropic',
  roleId: 'companion',
  toolGrants: {},
  replyStyle: 'text',
};

const claudeCode = Expert.parse({
  id: 'claude-code',
  name: 'Claude Code',
  connection: { type: 'claude-code' },
});

function win(id: string, title: string, extra: Partial<WindowEntry> = {}): WindowEntry {
  return { id, processName: 'Code.exe', title, state: 'foreground', browser: false, ...extra };
}

function setup(options: { reply?: string; settings?: Partial<Settings>; experts?: Expert[] } = {}) {
  const clock = { t: 0, now: () => clock.t };
  const settings = Settings.parse({ ...options.settings });
  const reads: Array<string | undefined> = [];
  const requests: BrainRequest[] = [];
  const remarks: PetRemarkParams[] = [];
  const moods: PetMoodParams[] = [];
  const proposals: Array<{ expertId: string; petId: string; brief: Brief }> = [];
  const state = { blocked: false };
  const host: PerceptionHost = {
    capabilities: ['textLayer'],
    capture: () => Promise.resolve({}),
    readText: ({ windowId }) => {
      reads.push(windowId);
      return Promise.resolve({
        windowId: windowId ?? 'w-?',
        text: state.blocked ? '' : 'FAIL parser.test.ts: Cannot find module ./lexer',
        truncated: false,
        source: 'uia',
        ...(state.blocked ? { blocked: { rule: 'processName', entry: 'x.exe' } } : {}),
      });
    },
  };
  const fake = new FakeBrainProvider({ text: '' });
  const provider: BrainProvider = {
    id: 'fake',
    capabilities: fake.capabilities,
    listModels: () => fake.listModels(),
    complete: (request) => {
      requests.push(request);
      return Promise.resolve({
        text: options.reply ?? 'NOTHING',
        stopReason: 'end',
        usage: { inputTokens: 1, outputTokens: 1 },
      });
    },
  };
  const eye = new KeepAnEye({
    clock,
    settings: () => settings,
    pet: () => scout,
    hosts: () => [host],
    provider: () => provider,
    experts: () => options.experts ?? [],
    propose: (params) => {
      proposals.push(params);
      return { proposalId: 'p-1' };
    },
    emit: (event) => {
      if (event.method === 'pet.remark') remarks.push(event.params);
      else moods.push(event.params);
    },
  });
  const at = async (ms: number, windows: WindowEntry[]) => {
    clock.t = ms;
    await eye.observe(windows);
  };
  return { eye, at, reads, requests, remarks, moods, proposals, state, clock };
}

describe('KeepAnEye', () => {
  it('reacts to a title with a mood, with no read and no model call', async () => {
    const { at, reads, requests, moods } = setup({ settings: { keepAnEye: true } });
    await at(0, [win('w-1', 'npm test - 12 passed', { processName: 'WindowsTerminal.exe' })]);
    expect(moods).toEqual([{ petId: 'scout', mood: 'cheer' }]);
    expect(reads).toEqual([]);
    expect(requests).toEqual([]);
  });

  it('shows no mood while keeping an eye is off', async () => {
    const { at, moods } = setup({ settings: { keepAnEye: false } });
    await at(0, [win('w-1', 'Build failed')]);
    expect(moods).toEqual([]);
  });

  it('reads the window the person settled on, asks once, and says the line', async () => {
    const { at, reads, requests, remarks } = setup({
      reply: 'parser.ts imports a missing ./lexer.',
    });
    const code = win('w-1', 'parser.test.ts - Code');
    await at(0, [code]);
    expect(reads).toEqual([]);
    await at(SETTLE_MS, [code]);
    expect(reads).toEqual(['w-1']);
    expect(requests).toHaveLength(1);
    expect(remarks).toEqual([
      {
        remarkId: expect.any(String),
        petId: 'scout',
        text: 'parser.ts imports a missing ./lexer.',
      },
    ]);
  });

  it('usually says nothing, and never asks about the same window again', async () => {
    const { at, requests, remarks } = setup({ reply: 'NOTHING' });
    const code = win('w-1', 'parser.test.ts - Code');
    await at(0, [code]);
    await at(SETTLE_MS, [code]);
    await at(SETTLE_MS * 4, [code]);
    expect(requests).toHaveLength(1);
    expect(remarks).toEqual([]);
  });

  it('does nothing at all when switched off', async () => {
    const { at, reads, requests } = setup({ settings: { keepAnEye: false } });
    await at(0, [win('w-1', 'Build failed')]);
    await at(SETTLE_MS, [win('w-1', 'Build failed')]);
    expect(reads).toEqual([]);
    expect(requests).toEqual([]);
  });

  it('asks nothing when the host refuses the window as a blind spot', async () => {
    const { at, state, requests } = setup({ reply: 'Something.' });
    state.blocked = true;
    await at(0, [win('w-1', 'Build failed')]);
    expect(requests).toEqual([]);
  });

  it('speaks at most once every ten minutes', async () => {
    const { at, remarks } = setup({ reply: 'That build broke on a missing import.' });
    await at(0, [win('w-1', 'Build failed')]);
    await at(1_000, [win('w-2', 'Tests failed')]);
    expect(remarks).toHaveLength(1);
    await at(COOLDOWN_MS, [win('w-2', 'Tests failed')]);
    expect(remarks).toHaveLength(2);
  });

  it('stays quiet for an hour after Not now', async () => {
    const { at, eye, remarks, clock } = setup({ reply: 'That build broke.' });
    expect(eye.notNow()).toEqual(new Date(clock.t + NOT_NOW_MS));
    await at(1_000, [win('w-1', 'Build failed')]);
    expect(remarks).toEqual([]);
    await at(NOT_NOW_MS, [win('w-1', 'Build failed')]);
    expect(remarks).toHaveLength(1);
  });

  it('offers a hand-off only when an expert is on, and proposes it only when accepted', async () => {
    const reply = 'That build broke on a missing import.\nOFFER: Fix the import in parser.ts';
    const without = setup({ reply });
    await without.at(0, [win('w-1', 'Build failed')]);
    expect(without.remarks[0]!.offer).toBeUndefined();

    const { at, eye, remarks, proposals } = setup({ reply, experts: [claudeCode] });
    await at(0, [win('w-1', 'Build failed')]);
    expect(remarks[0]!.offer).toBe('Fix the import in parser.ts');
    expect(proposals).toEqual([]);

    expect(eye.accept('00000000-0000-4000-8000-000000000000')).toBe(false);
    expect(eye.accept(remarks[0]!.remarkId)).toBe(true);
    expect(proposals).toEqual([
      {
        expertId: 'claude-code',
        petId: 'scout',
        brief: {
          ask: 'Fix the import in parser.ts',
          context: { app: 'Code', windowTitle: 'Build failed' },
        },
      },
    ]);
    // Once only: the card is the person's now.
    expect(eye.accept(remarks[0]!.remarkId)).toBe(false);
  });

  it('skips a snapshot while a look is still being written', async () => {
    const { eye, clock, requests } = setup({ reply: 'NOTHING' });
    const first = eye.observe([win('w-1', 'Build failed')]);
    clock.t = 1;
    await eye.observe([win('w-2', 'Tests failed')]);
    await first;
    expect(requests).toHaveLength(1);
  });
});
