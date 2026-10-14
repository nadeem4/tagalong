import { describe, expect, it } from 'vitest';
import type { Expert, RoutineAction, RoutineDraftInput, RoutineView } from '@tagalong/protocol';
import { FAKE_TURN_PET, fakeTurnTools as fakeTools } from '../fake-turn';
import type { ToolRegistryOptions, TurnRequest } from '../registry';
import { CHANGE_ROUTINE, CREATE_ROUTINE, type RoutineToolDeps } from './routines';

const RESEARCHER: Expert = {
  id: 'researcher',
  name: 'Researcher',
  goodAt: 'Web research',
  enabled: true,
  connection: { type: 'claude-code', canEdit: false },
};

const SAVED: RoutineView = {
  id: '6f1c2f4e-8a7b-4c1d-9e2f-3a4b5c6d7e8f',
  name: 'Morning papers',
  enabled: true,
  when: { type: 'schedule', days: [1, 2, 3, 4, 5], time: '08:00' },
  what: 'Find new papers.',
  topics: 'AI agents',
  deliver: { bubble: true, voice: false, notification: false },
  uses: [],
  createdAt: '2026-10-13T07:00:00.000Z',
};

function deps(saved: RoutineView[] = [SAVED]) {
  const proposed: {
    petId: string;
    action: RoutineAction;
    routine: RoutineDraftInput;
    routineId?: string | undefined;
  }[] = [];
  const value: RoutineToolDeps = {
    list: () => saved,
    experts: () => [RESEARCHER],
    propose: (params) => {
      proposed.push(params);
      return { proposalId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' };
    },
  };
  return { value, proposed };
}

const COMPANION = { ...FAKE_TURN_PET, roleId: 'companion' };
const tools = (options: ToolRegistryOptions, overrides: Partial<TurnRequest> = {}) =>
  fakeTools(options, { pet: COMPANION, ...overrides });

describe(CREATE_ROUTINE, () => {
  it('shows the card with the routine as it would be saved, and saves nothing', async () => {
    const d = deps();
    const outcome = await tools({ routines: d.value }).run({
      name: CREATE_ROUTINE,
      input: {
        name: 'Morning papers',
        when: { type: 'weekdays', time: '08:00' },
        what: 'Find new papers on my topics and explain the best one simply.',
        topics: 'AI agents',
        result: ['bubble', 'voice'],
        hand_to: 'researcher',
        uses: ['Researcher (Claude Code)'],
      },
    });
    expect(outcome.isError).toBeUndefined();
    expect(outcome.content).toContain('Save');
    expect(d.proposed).toEqual([
      {
        petId: 'scout',
        action: 'create',
        routine: {
          name: 'Morning papers',
          when: { type: 'schedule', days: [1, 2, 3, 4, 5], time: '08:00' },
          what: 'Find new papers on my topics and explain the best one simply.',
          topics: 'AI agents',
          deliver: { bubble: true, voice: true, notification: false },
          handTo: 'researcher',
          uses: ['Researcher (Claude Code)'],
        },
      },
    ]);
  });

  it('turns every day and chosen days into days of the week, and takes each trigger', async () => {
    const d = deps();
    const t = tools({ routines: d.value });
    await t.run({
      name: CREATE_ROUTINE,
      input: { name: 'A', what: 'x', when: { type: 'daily', time: '07:30' } },
    });
    await t.run({
      name: CREATE_ROUTINE,
      input: {
        name: 'B',
        what: 'x',
        when: { type: 'weekly', days: ['mon', 'fri'], time: '17:00' },
      },
    });
    await t.run({
      name: CREATE_ROUTINE,
      input: { name: 'C', what: 'x', when: { type: 'app', match: 'Outlook' } },
    });
    expect(d.proposed.map((p) => p.routine.when)).toEqual([
      { type: 'schedule', days: [0, 1, 2, 3, 4, 5, 6], time: '07:30' },
      { type: 'schedule', days: [1, 5], time: '17:00' },
      { type: 'app', match: 'Outlook' },
    ]);
    // Bubble when no result is named.
    expect(d.proposed[0]?.routine.deliver).toEqual({
      bubble: true,
      voice: false,
      notification: false,
    });
  });

  it('refuses a bad time, an unknown expert, or a missing field, by name', async () => {
    const d = deps();
    const t = tools({ routines: d.value });
    const badTime = await t.run({
      name: CREATE_ROUTINE,
      input: { name: 'A', what: 'x', when: { type: 'daily', time: '8am' } },
    });
    expect(badTime).toMatchObject({ isError: true });
    expect(badTime.content).toContain('HH:MM');
    const expert = await t.run({
      name: CREATE_ROUTINE,
      input: { name: 'A', what: 'x', when: { type: 'launch' }, hand_to: 'nobody' },
    });
    expect(expert.content).toContain('researcher');
    const missing = await t.run({ name: CREATE_ROUTINE, input: { name: 'A' } });
    expect(missing).toMatchObject({ isError: true });
    expect(d.proposed).toEqual([]);
  });

  it('is not offered on a routine’s own turn', () => {
    const t = tools(
      { routines: deps().value },
      { routine: { routineId: 'r1', handedOff: () => undefined } },
    );
    expect(t.definitions.map((d) => d.name)).not.toContain(CREATE_ROUTINE);
    expect(t.definitions.map((d) => d.name)).not.toContain(CHANGE_ROUTINE);
  });
});

describe(CHANGE_ROUTINE, () => {
  it('lists the saved routines by name in its description', () => {
    const description = tools({ routines: deps().value }).definitions.find(
      (d) => d.name === CHANGE_ROUTINE,
    )?.description;
    expect(description).toContain('Morning papers');
  });

  it('shows a card to pause, resume or delete a routine named by the person', async () => {
    const d = deps();
    const t = tools({ routines: d.value });
    for (const action of ['pause', 'resume', 'delete']) {
      await t.run({ name: CHANGE_ROUTINE, input: { name: 'morning papers', action } });
    }
    expect(d.proposed.map((p) => [p.action, p.routineId])).toEqual([
      ['pause', SAVED.id],
      ['resume', SAVED.id],
      ['delete', SAVED.id],
    ]);
  });

  it('shows a card with the change laid over the saved routine', async () => {
    const d = deps();
    await tools({ routines: d.value }).run({
      name: CHANGE_ROUTINE,
      input: {
        name: 'Morning papers',
        action: 'update',
        when: { type: 'daily', time: '09:00' },
        result: ['notification'],
      },
    });
    expect(d.proposed[0]).toMatchObject({
      action: 'update',
      routineId: SAVED.id,
      routine: {
        name: 'Morning papers',
        what: 'Find new papers.',
        topics: 'AI agents',
        when: { type: 'schedule', days: [0, 1, 2, 3, 4, 5, 6], time: '09:00' },
        deliver: { bubble: false, voice: false, notification: true },
      },
    });
  });

  it('names the routines there are when the one asked for is not one', async () => {
    const outcome = await tools({ routines: deps().value }).run({
      name: CHANGE_ROUTINE,
      input: { name: 'Evening', action: 'pause' },
    });
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.content).toContain('Morning papers');
  });

  it('is offered only when there is a routine to change', () => {
    const names = tools({ routines: deps([]).value }).definitions.map((d) => d.name);
    expect(names).toContain(CREATE_ROUTINE);
    expect(names).not.toContain(CHANGE_ROUTINE);
  });
});
