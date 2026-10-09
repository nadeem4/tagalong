import { describe, expect, it } from 'vitest';
import type { Brief, ContextSnapshot, Expert } from '@tagalong/protocol';
import { FAKE_TURN_PET, fakeTurnTools as fakeTools } from '../fake-turn';
import type { ToolRegistryOptions, TurnRequest } from '../registry';
import { HAND_TO_EXPERT, type ExpertToolDeps } from './experts';

const expert = (id: string, name: string, goodAt = '', enabled = true): Expert => ({
  id,
  name,
  goodAt,
  enabled,
  connection: { type: 'claude-code', folder: 'C:\\r', canEdit: false },
});

const CLAUDE = expert('claude-code', 'Claude Code', 'Code changes in this repo');
const GEMINI = expert('gemini', 'Gemini', 'Long documents');

function deps(experts: Expert[]) {
  const started: { expertId: string; petId: string; brief: Brief }[] = [];
  const routes = new Map<string, { expertId: string; by: 'companion' | 'user' }>();
  const value: ExpertToolDeps = {
    experts: () => experts,
    routes: {
      get: (kind) => routes.get(kind) ?? null,
      remember: (kind, expertId, by) => {
        if (routes.get(kind)?.by === 'user' && by === 'companion') return;
        routes.set(kind, { expertId, by });
      },
    },
    start: (params) => {
      started.push(params);
      return { handoffId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' };
    },
  };
  return { value, started, routes };
}

/** The tool is the Companion role's, so the turn's pet is a companion. */
const COMPANION = { ...FAKE_TURN_PET, roleId: 'companion' };
const fakeTurnTools = (options: ToolRegistryOptions, overrides: Partial<TurnRequest> = {}) =>
  fakeTools(options, { pet: COMPANION, ...overrides });

const SNAPSHOT: ContextSnapshot = {
  id: '11111111-2222-4333-8444-555555555555',
  capturedAt: '2026-10-09T10:00:00.000Z',
  host: 'desktop',
  app: { name: 'Code', windowTitle: 'runner.test.ts' },
  selection: 'expect(a).toBe(b)',
};

describe(HAND_TO_EXPERT, () => {
  it('is offered only when there is an expert switched on', () => {
    const none = fakeTurnTools({ experts: deps([]).value });
    expect(none.definitions.map((d) => d.name)).not.toContain(HAND_TO_EXPERT);
    const off = fakeTurnTools({ experts: deps([{ ...CLAUDE, enabled: false }]).value });
    expect(off.definitions.map((d) => d.name)).not.toContain(HAND_TO_EXPERT);
  });

  it('lists the experts and what they are good at in its description', () => {
    const tools = fakeTurnTools({ experts: deps([CLAUDE, GEMINI]).value });
    const description = tools.definitions.find((d) => d.name === HAND_TO_EXPERT)?.description;
    expect(description).toContain('claude-code (Claude Code): Code changes in this repo');
    expect(description).toContain('gemini (Gemini): Long documents');
  });

  it('builds the brief from the ask and what the user was looking at, and hands it off', async () => {
    const d = deps([CLAUDE, GEMINI]);
    const tools = fakeTurnTools({ experts: d.value }, { snapshot: SNAPSHOT });
    const outcome = await tools.run({
      name: HAND_TO_EXPERT,
      input: {
        expert_id: 'claude-code',
        task_kind: 'fix-code',
        ask: 'Why does this test fail?',
        files: ['packages/core/src/conversation/runner.test.ts'],
        good_answer: 'The cause and the fix.',
      },
    });
    expect(outcome.isError).toBeUndefined();
    expect(d.started).toEqual([
      {
        expertId: 'claude-code',
        petId: 'scout',
        brief: {
          ask: 'Why does this test fail?',
          context: { app: 'Code', windowTitle: 'runner.test.ts', selection: 'expect(a).toBe(b)' },
          files: ['packages/core/src/conversation/runner.test.ts'],
          goodAnswer: 'The cause and the fix.',
        },
      },
    ]);
    expect(outcome.content).toContain('Claude Code');
    expect(d.routes.get('fix-code')).toEqual({ expertId: 'claude-code', by: 'companion' });
  });

  it('uses the remembered expert for a kind of task when none is named', async () => {
    const d = deps([CLAUDE, GEMINI]);
    d.routes.set('summarise', { expertId: 'gemini', by: 'user' });
    const tools = fakeTurnTools({ experts: d.value });
    await tools.run({ name: HAND_TO_EXPERT, input: { task_kind: 'summarise', ask: 'Sum it up' } });
    expect(d.started[0]?.expertId).toBe('gemini');
  });

  it('keeps the user’s choice even when the companion names another expert', async () => {
    const d = deps([CLAUDE, GEMINI]);
    d.routes.set('summarise', { expertId: 'gemini', by: 'user' });
    const tools = fakeTurnTools({ experts: d.value });
    await tools.run({
      name: HAND_TO_EXPERT,
      input: { expert_id: 'claude-code', task_kind: 'summarise', ask: 'Sum it up' },
    });
    expect(d.started[0]?.expertId).toBe('gemini');
  });

  it('uses the only expert there is when nothing else decides', async () => {
    const d = deps([CLAUDE]);
    await fakeTurnTools({ experts: d.value }).run({
      name: HAND_TO_EXPERT,
      input: { task_kind: 'fix-code', ask: 'x' },
    });
    expect(d.started[0]?.expertId).toBe('claude-code');
  });

  it('asks the model to pick when there are several and no route', async () => {
    const d = deps([CLAUDE, GEMINI]);
    const outcome = await fakeTurnTools({ experts: d.value }).run({
      name: HAND_TO_EXPERT,
      input: { task_kind: 'new-kind', ask: 'x' },
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain('expert_id');
    expect(d.started).toEqual([]);
  });

  it('refuses an expert that is not there and a bad input, without throwing', async () => {
    const d = deps([CLAUDE]);
    const tools = fakeTurnTools({ experts: d.value });
    const unknown = await tools.run({
      name: HAND_TO_EXPERT,
      input: { expert_id: 'nobody', task_kind: 'x', ask: 'x' },
    });
    expect(unknown.isError).toBe(true);
    expect(unknown.content).toContain('claude-code');
    const bad = await tools.run({ name: HAND_TO_EXPERT, input: { task_kind: 'x' } });
    expect(bad.isError).toBe(true);
    expect(d.started).toEqual([]);
  });

  it('reports a hand-off that could not start', async () => {
    const d = deps([CLAUDE]);
    d.value.start = () => {
      throw new Error('Claude Code is switched off');
    };
    const outcome = await fakeTurnTools({ experts: d.value }).run({
      name: HAND_TO_EXPERT,
      input: { task_kind: 'x', ask: 'x' },
    });
    expect(outcome).toEqual({
      content: 'The hand-off to Claude Code did not start: Claude Code is switched off',
      isError: true,
    });
  });
});
