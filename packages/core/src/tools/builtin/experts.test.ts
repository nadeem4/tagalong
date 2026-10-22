/** Tests for the hand_to_expert and tell_expert tools: when offered, which expert, briefs. */
import { describe, expect, it } from 'vitest';
import type { Brief, ContextSnapshot, Expert } from '@tagalong/protocol';
import { FAKE_TURN_PET, fakeTurnTools as fakeTools } from '../fake-turn';
import { directivesIn } from '../test-support';
import type { ToolRegistryOptions, TurnRequest } from '../registry';
import { HAND_TO_EXPERT, TELL_EXPERT, type ExpertToolDeps } from './experts';

const expert = (id: string, name: string, goodAt = '', enabled = true): Expert => ({
  id,
  name,
  goodAt,
  enabled,
  instructions: '',
  connection: {
    type: 'claude-code',
    folder: 'C:\\r',
    canEdit: false,
    canSearchWeb: false,
    plugins: [],
    mcpTools: [],
    workspace: 'project' as const,
  },
});

const CLAUDE = expert('claude-code', 'Claude Code', 'Code changes in this repo');
const GEMINI = expert('gemini', 'Gemini', 'Long documents');

function deps(experts: Expert[]) {
  const started: { expertId: string; petId: string; turnId?: string; brief: Brief }[] = [];
  const value: ExpertToolDeps = {
    experts: () => experts,
    propose: (params) => {
      started.push(params);
      return { proposalId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' };
    },
  };
  return { value, started };
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
        // The turn that proposed it, so what the person does with the card is tied to it.
        turnId: 'turn-1',
        brief: {
          ask: 'Why does this test fail?',
          context: { app: 'Code', windowTitle: 'runner.test.ts', selection: 'expect(a).toBe(b)' },
          files: ['packages/core/src/conversation/runner.test.ts'],
          goodAnswer: 'The cause and the fix.',
        },
      },
    ]);
    // Nothing runs yet: the person checks the brief and the project first.
    expect(outcome.content).toContain('Send');
    expect(directivesIn(outcome.content)).toEqual([]);
  });

  it('has no task_kind: the model picks the expert from the list', () => {
    const tools = fakeTurnTools({ experts: deps([CLAUDE, GEMINI]).value });
    const definition = tools.definitions.find((d) => d.name === HAND_TO_EXPERT);
    expect(JSON.stringify(definition)).not.toContain('task_kind');
    expect(definition?.inputSchema['required']).toEqual(['ask']);
  });

  it('uses the expert the model names', async () => {
    const d = deps([CLAUDE, GEMINI]);
    const tools = fakeTurnTools({ experts: d.value });
    await tools.run({ name: HAND_TO_EXPERT, input: { expert_id: 'gemini', ask: 'Sum it up' } });
    expect(d.started[0]?.expertId).toBe('gemini');
  });

  it('uses the only expert there is when none is named', async () => {
    const d = deps([CLAUDE]);
    await fakeTurnTools({ experts: d.value }).run({
      name: HAND_TO_EXPERT,
      input: { ask: 'x' },
    });
    expect(d.started[0]?.expertId).toBe('claude-code');
  });

  it('needs expert_id when several are on, listing each with what it is good at', async () => {
    const d = deps([CLAUDE, GEMINI]);
    const outcome = await fakeTurnTools({ experts: d.value }).run({
      name: HAND_TO_EXPERT,
      input: { ask: 'x' },
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain('expert_id');
    expect(outcome.content).toContain('claude-code (Claude Code): Code changes in this repo');
    expect(outcome.content).toContain('gemini (Gemini): Long documents');
    expect(d.started).toEqual([]);
  });

  it('states that no expert is on when the last one was switched off during the turn', async () => {
    const list = [CLAUDE];
    const d = deps(list);
    const tools = fakeTurnTools({ experts: { ...d.value, experts: () => list } });
    list.splice(0, 1, { ...CLAUDE, enabled: false });
    for (const input of [{ ask: 'x' }, { ask: 'x', expert_id: 'claude-code' }]) {
      const outcome = await tools.run({ name: HAND_TO_EXPERT, input });
      expect(outcome.isError).toBe(true);
      expect(outcome.content).toBe('No expert is switched on.');
    }
    expect(d.started).toEqual([]);
  });

  it('refuses an expert that is not there and a bad input, without throwing', async () => {
    const d = deps([CLAUDE]);
    const tools = fakeTurnTools({ experts: d.value });
    const unknown = await tools.run({
      name: HAND_TO_EXPERT,
      input: { expert_id: 'nobody', ask: 'x' },
    });
    expect(unknown.isError).toBe(true);
    expect(unknown.content).toContain('claude-code');
    const bad = await tools.run({ name: HAND_TO_EXPERT, input: { files: ['a'] } });
    expect(bad.isError).toBe(true);
    expect(d.started).toEqual([]);
  });

  describe('with a follow-up step', () => {
    const REVIEWER = expert('reviewer', 'Reviewer', 'Checking a change');

    it('proposes both steps on one card', async () => {
      const d = deps([CLAUDE, REVIEWER]);
      const outcome = await fakeTurnTools({ experts: d.value }).run({
        name: HAND_TO_EXPERT,
        input: {
          expert_id: 'claude-code',
          ask: 'Fix the date bug',
          then: { expert_id: 'reviewer', ask: 'Check what Claude Code changed' },
        },
      });
      expect(outcome.isError).toBeUndefined();
      expect(outcome.content).toContain('Reviewer');
      expect(d.started).toEqual([
        {
          expertId: 'claude-code',
          petId: 'scout',
          turnId: 'turn-1',
          brief: { ask: 'Fix the date bug' },
          then: { expertId: 'reviewer', ask: 'Check what Claude Code changed' },
        },
      ]);
    });

    it('refuses an unknown, switched-off or same expert, or a bad step', async () => {
      const d = deps([CLAUDE, { ...REVIEWER, enabled: false }]);
      const tools = fakeTurnTools({ experts: d.value });
      const run = (then: unknown) =>
        tools.run({
          name: HAND_TO_EXPERT,
          input: { expert_id: 'claude-code', ask: 'Fix it', then },
        });
      const unknown = await run({ expert_id: 'nobody', ask: 'Check' });
      expect(unknown.isError).toBe(true);
      expect(unknown.content).toContain('nobody');
      const off = await run({ expert_id: 'reviewer', ask: 'Check' });
      expect(off.isError).toBe(true);
      const same = await run({ expert_id: 'claude-code', ask: 'Check' });
      expect(same.isError).toBe(true);
      expect(same.content).toMatch(/different expert/);
      const bad = await run({ expert_id: 'reviewer' });
      expect(bad.isError).toBe(true);
      expect(d.started).toEqual([]);
    });

    it('always shows the card in a routine, even for the expert it allowed', async () => {
      const d = deps([CLAUDE, REVIEWER]);
      const research: unknown[] = [];
      d.value.startReadOnly = (params) => {
        research.push(params);
        return { handoffId: 'a3bb189e-8bf9-4888-9912-ace4e6543002' };
      };
      const tools = fakeTurnTools(
        { experts: d.value },
        {
          routine: {
            routineId: 'r1',
            name: 'Routine',
            expertId: 'claude-code',
            handedOff: () => undefined,
          },
        },
      );
      await tools.run({
        name: HAND_TO_EXPERT,
        input: {
          ask: 'Fix it',
          expert_id: 'claude-code',
          then: { expert_id: 'reviewer', ask: 'Check it' },
        },
      });
      expect(research).toEqual([]);
      expect(d.started).toHaveLength(1);
    });
  });

  it('reports a hand-off that could not be proposed', async () => {
    const d = deps([CLAUDE]);
    d.value.propose = () => {
      throw new Error('Claude Code is switched off');
    };
    const outcome = await fakeTurnTools({ experts: d.value }).run({
      name: HAND_TO_EXPERT,
      input: { ask: 'x' },
    });
    expect(outcome).toEqual({
      content: 'The brief for Claude Code could not be shown: Claude Code is switched off',
      isError: true,
    });
  });

  describe('in a routine', () => {
    const routineDeps = () => {
      const d = deps([CLAUDE, GEMINI]);
      const research: { expertId: string; petId: string; brief: Brief }[] = [];
      d.value.startReadOnly = (params) => {
        research.push(params);
        return { handoffId: 'a3bb189e-8bf9-4888-9912-ace4e6543002' };
      };
      return { ...d, research };
    };

    it('starts the expert the routine allowed at once, read-only, with no card', async () => {
      const d = routineDeps();
      const handed: string[] = [];
      const outcome = await fakeTurnTools(
        { experts: d.value },
        {
          routine: {
            routineId: 'r1',
            name: 'Routine',
            expertId: 'claude-code',
            instruction: 'Find new papers on agents each morning.',
            handedOff: (id) => handed.push(id),
          },
          snapshot: SNAPSHOT,
        },
      ).run({
        name: HAND_TO_EXPERT,
        input: {
          expert_id: 'claude-code',
          ask: 'New papers on agents',
          files: ['notes.txt'],
        },
      });
      expect(outcome.isError).toBeUndefined();
      expect(outcome.content).toContain('read-only');
      expect(directivesIn(outcome.content)).toEqual([]);
      // Only the saved instruction and the model's request: no screen, no files.
      expect(d.research).toEqual([
        {
          expertId: 'claude-code',
          petId: 'scout',
          brief: {
            ask:
              'The saved routine asks: Find new papers on agents each morning.\n\n' +
              'This run: New papers on agents',
          },
        },
      ]);
      expect(handed).toEqual(['a3bb189e-8bf9-4888-9912-ace4e6543002']);
      expect(d.started).toEqual([]);
    });

    it('pre-approves only one hand-off per run; the next one shows the normal card', async () => {
      const d = routineDeps();
      const tools = fakeTurnTools(
        { experts: d.value },
        {
          routine: {
            routineId: 'r1',
            name: 'Routine',
            expertId: 'claude-code',
            instruction: 'Research.',
            handedOff: () => undefined,
          },
        },
      );
      const call = {
        name: HAND_TO_EXPERT,
        input: { expert_id: 'claude-code', ask: 'a' },
      };
      await tools.run(call);
      const second = await tools.run(call);
      expect(d.research).toHaveLength(1);
      expect(d.started.map((s) => s.expertId)).toEqual(['claude-code']);
      expect(second.content).toContain('on a card');
    });

    it('shows the normal card for any other expert, or when the routine allowed none', async () => {
      const d = routineDeps();
      const handedOff = () => undefined;
      await fakeTurnTools(
        { experts: d.value },
        { routine: { routineId: 'r1', name: 'Routine', expertId: 'claude-code', handedOff } },
      ).run({ name: HAND_TO_EXPERT, input: { expert_id: 'gemini', ask: 'x' } });
      await fakeTurnTools(
        { experts: d.value },
        { routine: { routineId: 'r1', name: 'Routine', handedOff } },
      ).run({
        name: HAND_TO_EXPERT,
        input: { expert_id: 'claude-code', ask: 'y' },
      });
      expect(d.research).toEqual([]);
      expect(d.started.map((s) => s.expertId)).toEqual(['gemini', 'claude-code']);
    });
  });
});

describe(TELL_EXPERT, () => {
  const CODER_RUN = {
    handoffId: '0b6f0c4e-1111-4222-8333-444455556666',
    expertId: 'claude-code',
    expertName: 'Claude Code',
    ask: 'Fix the date bug',
  };
  const WRITER_RUN = {
    handoffId: '0b6f0c4e-9999-4222-8333-444455556666',
    expertId: 'gemini',
    expertName: 'Gemini',
    ask: 'Summarise the spec',
  };

  function steering(running: (typeof CODER_RUN)[], refuse?: string) {
    const d = deps([CLAUDE, GEMINI]);
    const told: { handoffId: string; text: string }[] = [];
    const value: ExpertToolDeps = {
      ...d.value,
      running: () => running,
      steer: (handoffId, text) => {
        told.push({ handoffId, text });
        return refuse === undefined ? { ok: true } : { ok: false, error: refuse };
      },
    };
    return { value, told };
  }

  const names = (options: ToolRegistryOptions, overrides: Partial<TurnRequest> = {}) =>
    fakeTurnTools(options, overrides).definitions.map((d) => d.name);

  it('is offered only while an expert is working, and never on a routine’s own turn', () => {
    expect(names({ experts: steering([]).value })).not.toContain(TELL_EXPERT);
    expect(names({ experts: deps([CLAUDE]).value })).not.toContain(TELL_EXPERT);
    expect(names({ experts: steering([CODER_RUN]).value })).toContain(TELL_EXPERT);
    expect(
      names(
        { experts: steering([CODER_RUN]).value },
        { routine: { routineId: 'r1', name: 'Routine', handedOff: () => undefined } },
      ),
    ).not.toContain(TELL_EXPERT);
  });

  it('lists what is running in its description, and is a write', () => {
    const tools = fakeTurnTools({ experts: steering([CODER_RUN, WRITER_RUN]).value });
    const description = tools.definitions.find((d) => d.name === TELL_EXPERT)?.description;
    expect(description).toContain(`${CODER_RUN.handoffId} (Claude Code): Fix the date bug`);
    expect(description).toContain(`${WRITER_RUN.handoffId} (Gemini): Summarise the spec`);
    expect(tools.tools.find((t) => t.id === TELL_EXPERT)?.kind).toBe('write');
  });

  it('passes the words to the one running expert when no id is given', async () => {
    const s = steering([CODER_RUN]);
    const outcome = await fakeTurnTools({ experts: s.value }).run({
      name: TELL_EXPERT,
      input: { message: 'use dayjs, not moment' },
    });
    expect(outcome.isError).toBeUndefined();
    expect(outcome.content).toContain('Claude Code');
    expect(directivesIn(outcome.content)).toEqual([]);
    expect(s.told).toEqual([{ handoffId: CODER_RUN.handoffId, text: 'use dayjs, not moment' }]);
  });

  it('asks which one when two are running and no id is given', async () => {
    const s = steering([CODER_RUN, WRITER_RUN]);
    const outcome = await fakeTurnTools({ experts: s.value }).run({
      name: TELL_EXPERT,
      input: { message: 'hurry up' },
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain(CODER_RUN.handoffId);
    expect(s.told).toEqual([]);
  });

  it('names the one asked for, and refuses an id that is not running', async () => {
    const s = steering([CODER_RUN, WRITER_RUN]);
    const tools = fakeTurnTools({ experts: s.value });
    await tools.run({
      name: TELL_EXPERT,
      input: { message: 'shorter', handoff_id: WRITER_RUN.handoffId },
    });
    expect(s.told).toEqual([{ handoffId: WRITER_RUN.handoffId, text: 'shorter' }]);
    const wrong = await tools.run({
      name: TELL_EXPERT,
      input: { message: 'x', handoff_id: 'nope' },
    });
    expect(wrong.isError).toBe(true);
    expect(s.told).toHaveLength(1);
  });

  it('says so when nothing is running any more, or the hand-off refuses the note', async () => {
    let running = [CODER_RUN];
    const s = steering([], 'That hand-off is not running, so there is no one to tell.');
    const value: ExpertToolDeps = { ...s.value, running: () => running };
    const tools = fakeTurnTools({ experts: value });
    const refused = await tools.run({ name: TELL_EXPERT, input: { message: 'x' } });
    expect(refused).toEqual({
      content: 'That hand-off is not running, so there is no one to tell.',
      isError: true,
    });
    running = [];
    const none = await tools.run({ name: TELL_EXPERT, input: { message: 'x' } });
    expect(none.isError).toBe(true);
    expect(none.content).toMatch(/No expert is working/);
  });

  it('refuses an empty message', async () => {
    const s = steering([CODER_RUN]);
    const outcome = await fakeTurnTools({ experts: s.value }).run({
      name: TELL_EXPERT,
      input: { message: ' ' },
    });
    expect(outcome.isError).toBe(true);
    expect(s.told).toEqual([]);
  });
});
