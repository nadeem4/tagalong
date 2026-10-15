import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import type { MemoryStore, NewMemory } from '../memory/memories';
import { FakeBrainProvider } from '../providers';
import { FakeClock } from '../watch/fake-clock';
import { WatchManager } from '../watch/watch-manager';
import { FAKE_TURN_PET, fakeTurn } from './fake-turn';
import { ToolRegistry, toolsFor, type ToolRegistryOptions } from './registry';
import type { Tool } from './tool';
import { getRole } from '../roles';

/** Only `addOnce` is reached by the tools; the rest of the store is not under test here. */
function fakeMemory(): MemoryStore & { saved: NewMemory[] } {
  const saved: NewMemory[] = [];
  return {
    saved,
    addOnce: (memory: NewMemory) => {
      saved.push(memory);
    },
  } as unknown as MemoryStore & { saved: NewMemory[] };
}

function everything(overrides: Partial<ToolRegistryOptions> = {}): ToolRegistryOptions {
  const hosts = () => [];
  return {
    perception: { hosts, exclusions: () => ({ processNames: [], titlePatterns: [] }) },
    memory: fakeMemory(),
    watch: {
      manager: new WatchManager({
        clock: new FakeClock(0),
        hosts,
        provider: () => new FakeBrainProvider({ text: 'no' }),
        limits: () => ({ maxChecks: 60, maxConcurrent: 3, defaultTimeoutMinutes: 30 }),
        emit: () => undefined,
      }),
      hosts,
    },
    day: {
      activity: { since: () => [] },
      sightLog: { list: () => [] },
      handoffs: { pending: () => [] },
      now: () => new Date(0),
    },
    // Every wired tool: what the role library narrows is the toolsFor tests' business.
    toolsFor: (_pet, tools) => tools,
    ...overrides,
  };
}

const ALL_TOOLS = [
  'look_at_screen',
  'get_selection',
  'list_displays',
  'look_at_display',
  'look_closer',
  'list_windows',
  'read_window_text',
  'look_at_window',
  'recall_screen',
  'what_changed',
  'remember',
  'watch_for',
  'point_at',
  'recall_day',
];

describe('ToolRegistry.forTurn', () => {
  it('builds every built-in tool, in the order the model has always seen them', () => {
    const turn = new ToolRegistry(everything()).forTurn(fakeTurn());

    expect(turn.tools.map((tool) => tool.id)).toEqual(ALL_TOOLS);
    expect(turn.definitions.map((definition) => definition.name)).toEqual(ALL_TOOLS);
  });

  it('gives every tool one shape whose id is the name the model sees', () => {
    for (const tool of new ToolRegistry(everything()).forTurn(fakeTurn()).tools) {
      expect(tool.id).toBe(tool.definition.name);
      expect(typeof tool.run).toBe('function');
    }
  });

  it('gives every tool a plain object schema, with no oneOf, anyOf or allOf at the top', () => {
    // The Anthropic and OpenAI APIs refuse the whole request when one tool's schema has them.
    for (const definition of new ToolRegistry(everything()).forTurn(fakeTurn()).definitions) {
      expect(definition.inputSchema['type'], definition.name).toBe('object');
      for (const key of ['oneOf', 'anyOf', 'allOf']) {
        expect(definition.inputSchema, definition.name).not.toHaveProperty(key);
      }
    }
  });

  it('marks only the tools that change stored state as write', () => {
    const tools = new ToolRegistry(everything()).forTurn(fakeTurn()).tools;
    const writes = tools.filter((tool) => tool.kind === 'write').map((tool) => tool.id);

    expect(writes).toEqual(['remember', 'watch_for']);
    expect(tools.filter((tool) => tool.kind === 'read')).toHaveLength(12);
  });

  it('gives a companion its tools, then the routine tools (write), point_at and recall_day', () => {
    const experts = {
      experts: () => [
        {
          id: 'claude-code',
          name: 'Claude Code',
          goodAt: '',
          enabled: true,
          instructions: '',
          connection: {
            type: 'claude-code' as const,
            folder: 'C:\\r',
            canEdit: false,
            canSearchWeb: false,
          },
        },
      ],
      routes: { get: () => null, remember: () => undefined },
      propose: () => ({ proposalId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
    };
    const routines = {
      list: () => [
        {
          id: '6f1c2f4e-8a7b-4c1d-9e2f-3a4b5c6d7e8f',
          name: 'Morning papers',
          enabled: true,
          when: { type: 'launch' as const },
          what: 'x',
          topics: '',
          deliver: { bubble: true, voice: false, notification: false },
          uses: [],
          createdAt: '2026-10-13T07:00:00.000Z',
        },
      ],
      experts: experts.experts,
      propose: () => ({ proposalId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
    };
    const tools = new ToolRegistry(everything({ experts, routines, toolsFor })).forTurn(
      fakeTurn({ pet: { ...FAKE_TURN_PET, roleId: 'companion' } }),
    ).tools;
    expect(tools.map((tool) => tool.id)).toEqual([
      'look_at_screen',
      'get_selection',
      'list_displays',
      'look_at_display',
      'look_closer',
      'list_windows',
      'read_window_text',
      'look_at_window',
      'recall_screen',
      'what_changed',
      'remember',
      'watch_for',
      'hand_to_expert',
      'create_routine',
      'change_routine',
      'point_at',
      'recall_day',
    ]);
    for (const id of ['hand_to_expert', 'create_routine', 'change_routine']) {
      expect(tools.find((tool) => tool.id === id)?.kind).toBe('write');
    }
  });

  it('builds only what is wired: no perception options, no perception tools', () => {
    const turn = new ToolRegistry({ memory: fakeMemory() }).forTurn(fakeTurn());
    expect(turn.tools.map((tool) => tool.id)).toEqual(['remember']);
  });

  it('gives a turn no tools when its provider cannot call them', () => {
    const turn = new ToolRegistry(everything()).forTurn(fakeTurn({ toolSupport: false }));

    expect(turn.tools).toEqual([]);
    expect(turn.definitions).toEqual([]);
  });

  it('dispatches by name with the turn as context', async () => {
    const memory = fakeMemory();
    const turn = new ToolRegistry({ memory }).forTurn(fakeTurn());

    const outcome = await turn.run({ name: 'remember', input: { text: 'Likes tea.' } });

    expect(outcome).toEqual({ content: 'Saved to your memory.' });
    expect(memory.saved).toEqual([
      { scope: 'pet', petId: FAKE_TURN_PET.id, kind: 'fact', text: 'Likes tea.' },
    ]);
  });

  it('refuses a tool it does not have by name, so the model can correct itself', async () => {
    const outcome = await new ToolRegistry(everything())
      .forTurn(fakeTurn())
      .run({ name: 'delete_everything' });

    expect(outcome.isError).toBe(true);
    expect(outcome.content).toBe("'delete_everything' is not a tool Tagalong provides.");
  });
});

describe('toolsFor', () => {
  const ids = (pet: Pet): string[] =>
    new ToolRegistry(everything({ toolsFor }))
      .forTurn(fakeTurn({ pet }))
      .tools.map((tool) => tool.id);
  const companion = getRole('companion')!;

  it('gives a pet exactly the tools its role lists, in the registry order', () => {
    expect(ids({ ...FAKE_TURN_PET, roleId: 'companion' })).toEqual(
      ALL_TOOLS.filter((id) => companion.tools.includes(id)),
    );
  });

  it('never offers a tool outside the role', () => {
    const pet = { ...FAKE_TURN_PET, roleId: 'companion' };
    const turn = new ToolRegistry(everything({ toolsFor })).forTurn(fakeTurn({ pet }));
    const offered = turn.definitions.map((definition) => definition.name);
    for (const name of offered) expect(companion.tools).toContain(name);

    const outside = { ...turn.tools[0]!, id: 'write_file' };
    expect(toolsFor(pet, [...turn.tools, outside]).map((tool) => tool.id)).not.toContain(
      'write_file',
    );
  });

  it('never offers or runs watch_for on a routine’s turn, so a watch routine cannot loop', async () => {
    const turn = new ToolRegistry(everything()).forTurn(
      fakeTurn({ routine: { routineId: 'r', handedOff: () => undefined } }),
    );
    expect(turn.definitions.map((definition) => definition.name)).not.toContain('watch_for');
    const outcome = await turn.run({ name: 'watch_for', input: { condition: 'a build ends' } });
    expect(outcome.isError).toBe(true);
  });

  it('never offers watch_for to the companion on a routine’s turn, though its role lists it', () => {
    const turn = new ToolRegistry(everything({ toolsFor })).forTurn(
      fakeTurn({
        pet: { ...FAKE_TURN_PET, roleId: 'companion' },
        routine: { routineId: 'r', handedOff: () => undefined },
      }),
    );
    expect(companion.tools).toContain('watch_for');
    expect(turn.definitions.map((definition) => definition.name)).not.toContain('watch_for');
  });

  it("takes away a role's tool the pet's grants turn off", () => {
    const granted = ids({
      ...FAKE_TURN_PET,
      roleId: 'companion',
      toolGrants: { remember: 'off', look_at_screen: 'allowed' },
    });
    expect(granted).not.toContain('remember');
    expect(granted).toContain('look_at_screen');
  });

  it('cannot grant a tool the role does not list', () => {
    const pet: Pet = {
      ...FAKE_TURN_PET,
      roleId: 'companion',
      toolGrants: { write_file: 'allowed' },
    };
    const tools = new ToolRegistry(everything()).forTurn(fakeTurn({ pet })).tools;
    const outside = { ...tools[0]!, id: 'write_file' };
    expect(toolsFor(pet, [...tools, outside]).map((tool) => tool.id)).not.toContain('write_file');
  });

  it("gives a pet with a role the library does not have the companion's tools", () => {
    // A crew-era role, still on a pet saved before the crew went.
    expect(ids({ ...FAKE_TURN_PET, roleId: 'writer' })).toEqual(
      ids({ ...FAKE_TURN_PET, roleId: 'companion' }),
    );
  });

  it('is the one place a turn is narrowed: what it drops is neither offered nor run', async () => {
    const seen: { pet: Pet; ids: string[] }[] = [];
    const readOnly = (pet: Pet, tools: readonly Tool[]): readonly Tool[] => {
      seen.push({ pet, ids: tools.map((tool) => tool.id) });
      return tools.filter((tool) => tool.kind === 'read');
    };
    const memory = fakeMemory();
    const turn = new ToolRegistry(everything({ memory, toolsFor: readOnly })).forTurn(fakeTurn());

    expect(seen).toEqual([{ pet: FAKE_TURN_PET, ids: ALL_TOOLS }]);
    expect(turn.definitions.map((definition) => definition.name)).not.toContain('remember');
    expect(turn.definitions.map((definition) => definition.name)).not.toContain('watch_for');

    const outcome = await turn.run({ name: 'remember', input: { text: 'Likes tea.' } });
    expect(outcome.isError).toBe(true);
    expect(memory.saved).toEqual([]);
  });
});
