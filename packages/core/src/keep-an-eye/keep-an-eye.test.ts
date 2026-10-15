import { describe, expect, it } from 'vitest';
import { Expert, Settings } from '@tagalong/protocol';
import type { Brief, Pet, PetMoodParams, PetRemarkParams, WindowEntry } from '@tagalong/protocol';
import { FakeBrainProvider } from '../providers';
import type { BrainProvider, BrainRequest } from '../providers';
import type { PerceptionHost } from '../perception';
import { KeepAnEye } from './keep-an-eye';
import { COOLDOWN_MS, NOT_NOW_MS, SETTLE_MS } from './lookout';
import { STUCK_MS } from './stuck';

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

const coder = Expert.parse({
  id: 'coder',
  name: 'Coder',
  goodAt: 'Fixing code',
  connection: { type: 'claude-code' },
});

function setup(
  options: {
    reply?: string;
    settings?: Partial<Settings>;
    experts?: Expert[];
    spentOut?: () => boolean;
    text?: string;
    readFails?: boolean;
  } = {},
) {
  const clock = { t: 0, now: () => clock.t };
  const settings = Settings.parse({ ...options.settings });
  const reads: Array<string | undefined> = [];
  const requests: BrainRequest[] = [];
  const remarks: PetRemarkParams[] = [];
  const moods: PetMoodParams[] = [];
  const proposals: Array<{
    expertId: string;
    petId: string;
    brief: Brief;
    projectHint?: string;
  }> = [];
  const state = { blocked: false };
  const host: PerceptionHost = {
    capabilities: ['textLayer'],
    capture: () => Promise.resolve({}),
    readText: ({ windowId }) => {
      reads.push(windowId);
      if (options.readFails === true) return Promise.reject(new Error('UIA timed out'));
      return Promise.resolve({
        windowId: windowId ?? 'w-?',
        text: state.blocked
          ? ''
          : (options.text ?? 'FAIL parser.test.ts: Cannot find module ./lexer'),
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
    ...(options.spentOut !== undefined ? { spentOut: options.spentOut } : {}),
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

  it('reads nothing and asks nothing once today’s budget is spent, and resumes after', async () => {
    const budget = { spent: true };
    const { at, reads, requests, remarks } = setup({
      reply: 'Something.',
      spentOut: () => budget.spent,
    });
    const code = win('w-1', 'Build failed');
    await at(0, [code]);
    await at(SETTLE_MS, [code]);
    expect(reads).toEqual([]);
    expect(requests).toEqual([]);
    expect(remarks).toEqual([]);

    budget.spent = false;
    await at(SETTLE_MS * 2, [code]);
    await at(SETTLE_MS * 3, [code]);
    expect(requests).toHaveLength(1);
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

    expect(await eye.accept('00000000-0000-4000-8000-000000000000')).toBe(false);
    expect(await eye.accept(remarks[0]!.remarkId)).toBe(true);
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
    expect(await eye.accept(remarks[0]!.remarkId)).toBe(false);
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

describe('KeepAnEye: Stuck?', () => {
  const failing = win('w-1', 'npm test - 2 failed', { processName: 'WindowsTerminal.exe' });
  const editor = win('w-2', 'parser.ts - ai_pet - Visual Studio Code', { state: 'background' });

  async function stuck(options: Parameters<typeof setup>[0] = {}) {
    const run = setup({ experts: [claudeCode, coder], ...options });
    await run.at(0, [
      { ...editor, state: 'foreground' },
      { ...failing, state: 'background' },
    ]);
    await run.at(1_000, [failing, editor]);
    // The look at the error itself, the moment it showed: one read, one call, nothing to say.
    const before = { reads: run.reads.length, requests: run.requests.length };
    await run.at(STUCK_MS, [failing, editor]);
    return { ...run, before };
  }

  it('offers, in its own words, to hand an error that stayed up to Coder, reading nothing', async () => {
    const { remarks, reads, requests, before, proposals } = await stuck();
    expect(remarks).toEqual([
      {
        remarkId: expect.any(String),
        petId: 'scout',
        text: 'That error’s still up. Want me to hand it to Coder?',
        offer: 'Fix the error in npm test - 2 failed',
      },
    ]);
    expect(reads).toHaveLength(before.reads);
    expect(requests).toHaveLength(before.requests);
    expect(proposals).toEqual([]);
  });

  it('says nothing with no expert switched on', async () => {
    const { remarks } = await stuck({ experts: [{ ...coder, enabled: false }] });
    expect(remarks).toEqual([]);
  });

  it('says nothing after Not now', async () => {
    const run = setup({ experts: [coder] });
    run.eye.notNow();
    await run.at(0, [failing]);
    await run.at(STUCK_MS, [failing]);
    expect(run.remarks).toEqual([]);
  });

  it('reads the window once on Hand it over, hides secrets, and proposes to Coder with the hint', async () => {
    const key = 'sk-ant-' + 'a'.repeat(40);
    const { eye, remarks, reads, before, proposals } = await stuck({
      text: `npm ERR! auth ${key}\nFAIL parser.test.ts`,
    });
    expect(await eye.accept(remarks[0]!.remarkId)).toBe(true);
    expect(reads.slice(before.reads)).toEqual(['w-1']);
    expect(proposals).toHaveLength(1);
    const { expertId, brief, projectHint } = proposals[0]!;
    expect(expertId).toBe('coder');
    expect(projectHint).toBe(`npm test - 2 failed - ${editor.title}`);
    expect(brief.ask).toBe('Fix the error in npm test - 2 failed');
    expect(brief.context).toMatchObject({ app: 'WindowsTerminal', windowTitle: failing.title });
    expect(brief.context?.windowText).toContain('FAIL parser.test.ts');
    expect(brief.context?.windowText).not.toContain(key);
    expect(await eye.accept(remarks[0]!.remarkId)).toBe(false);
    expect(reads.slice(before.reads)).toEqual(['w-1']);
  });

  it('still opens the card, without the text, when the read fails or is refused', async () => {
    const failed = await stuck({ readFails: true });
    expect(await failed.eye.accept(failed.remarks[0]!.remarkId)).toBe(true);
    expect(failed.proposals[0]!.brief.context?.windowText).toBeUndefined();

    const refused = await stuck();
    refused.state.blocked = true;
    expect(await refused.eye.accept(refused.remarks[0]!.remarkId)).toBe(true);
    expect(refused.proposals[0]!.brief.context?.windowText).toBeUndefined();
  });

  it('picks Coder by name, then by what it is good at, then the first one on', async () => {
    const byGoodAt = Expert.parse({ ...coder, id: 'bolt', name: 'Bolt', goodAt: 'Code reviews' });
    const run = await stuck({ experts: [claudeCode, byGoodAt] });
    expect(run.remarks[0]!.text).toBe('That error’s still up. Want me to hand it to Bolt?');
    await run.eye.accept(run.remarks[0]!.remarkId);
    expect(run.proposals[0]!.expertId).toBe('bolt');

    const first = await stuck({ experts: [claudeCode] });
    expect(first.remarks[0]!.text).toContain('hand it to Claude Code?');
  });
});
