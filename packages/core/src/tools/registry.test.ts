import { describe, expect, it } from 'vitest';
import { Settings, type Pet } from '@tagalong/protocol';
import type { MemoryStore, NewMemory } from '../memory/memories';
import { FakeBrainProvider } from '../providers';
import { FakeClock } from '../watch/fake-clock';
import { WatchManager } from '../watch/watch-manager';
import { FAKE_TURN_PET, fakeTurn } from './fake-turn';
import { ToolRegistry, toolsFor, type ToolRegistryOptions } from './registry';
import type { Tool } from './tool';
import { getRole } from '../roles';

const ink: Pet = { ...FAKE_TURN_PET, id: 'ink', name: 'Ink', notes: 'You polish prose.' };

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
    consult: {
      pets: () => [FAKE_TURN_PET, ink],
      provider: () => new FakeBrainProvider({ text: 'ok' }),
      settings: () => Settings.parse({}),
    },
    ...overrides,
  };
}

const ALL_TWELVE = [
  'look_at_screen',
  'get_selection',
  'list_displays',
  'look_at_display',
  'look_closer',
  'list_windows',
  'read_window_text',
  'recall_screen',
  'what_changed',
  'remember',
  'watch_for',
  'ask_pet',
];

describe('ToolRegistry.forTurn', () => {
  it('builds all twelve built-in tools, in the order the model has always seen them', () => {
    const turn = new ToolRegistry(everything()).forTurn(fakeTurn());

    expect(turn.tools.map((tool) => tool.id)).toEqual(ALL_TWELVE);
    expect(turn.definitions.map((definition) => definition.name)).toEqual(ALL_TWELVE);
  });

  it('gives every tool one shape whose id is the name the model sees', () => {
    for (const tool of new ToolRegistry(everything()).forTurn(fakeTurn()).tools) {
      expect(tool.id).toBe(tool.definition.name);
      expect(typeof tool.run).toBe('function');
    }
  });

  it('marks only the tools that change stored state as write', () => {
    const tools = new ToolRegistry(everything()).forTurn(fakeTurn()).tools;
    const writes = tools.filter((tool) => tool.kind === 'write').map((tool) => tool.id);

    expect(writes).toEqual(['remember', 'watch_for']);
    expect(tools.filter((tool) => tool.kind === 'read')).toHaveLength(10);
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

  it('leaves ask_pet off a turn that may not consult, and off a crew of one', () => {
    const roundtable = new ToolRegistry(everything()).forTurn(fakeTurn({ allowConsult: false }));
    expect(roundtable.tools.map((tool) => tool.id)).not.toContain('ask_pet');

    const alone = new ToolRegistry(
      everything({
        consult: {
          pets: () => [FAKE_TURN_PET],
          provider: () => new FakeBrainProvider({ text: 'ok' }),
          settings: () => Settings.parse({}),
        },
      }),
    ).forTurn(fakeTurn());
    expect(alone.tools.map((tool) => tool.id)).not.toContain('ask_pet');
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
    new ToolRegistry(everything()).forTurn(fakeTurn({ pet })).tools.map((tool) => tool.id);

  it('hands a generalist every tool, since its role lists all twelve', () => {
    const tools = new ToolRegistry(everything()).forTurn(fakeTurn()).tools;
    expect(toolsFor(FAKE_TURN_PET, tools)).toEqual(tools);
  });

  it('gives a pet exactly the tools its role lists, in the registry order', () => {
    const writer = getRole('writer')!;
    expect(ids({ ...FAKE_TURN_PET, roleId: 'writer' })).toEqual(
      ALL_TWELVE.filter((id) => writer.tools.includes(id)),
    );
  });

  it('never offers or runs a tool outside the role', async () => {
    const memory = fakeMemory();
    const turn = new ToolRegistry(everything({ memory })).forTurn(
      fakeTurn({ pet: { ...FAKE_TURN_PET, roleId: 'writer' } }),
    );
    const offered = turn.definitions.map((definition) => definition.name);
    for (const name of offered) expect(getRole('writer')!.tools).toContain(name);
    expect(offered).not.toContain('watch_for');

    const outcome = await turn.run({ name: 'watch_for', input: { condition: 'a build ends' } });
    expect(outcome.isError).toBe(true);
  });

  it("takes away a role's tool the pet's grants turn off", () => {
    const granted = ids({
      ...FAKE_TURN_PET,
      roleId: 'backend-engineer',
      toolGrants: { watch_for: 'off', remember: 'allowed' },
    });
    expect(granted).not.toContain('watch_for');
    expect(granted).toContain('remember');
  });

  it('cannot grant a tool the role does not list', () => {
    expect(
      ids({ ...FAKE_TURN_PET, roleId: 'writer', toolGrants: { watch_for: 'allowed' } }),
    ).not.toContain('watch_for');
  });

  it("gives a pet with a role the library does not have the generalist's tools", () => {
    expect(ids({ ...FAKE_TURN_PET, roleId: 'astronaut' })).toEqual(ALL_TWELVE);
  });

  it('is the one place a turn is narrowed: what it drops is neither offered nor run', async () => {
    const seen: { pet: Pet; ids: string[] }[] = [];
    const readOnly = (pet: Pet, tools: readonly Tool[]): readonly Tool[] => {
      seen.push({ pet, ids: tools.map((tool) => tool.id) });
      return tools.filter((tool) => tool.kind === 'read');
    };
    const memory = fakeMemory();
    const turn = new ToolRegistry(everything({ memory, toolsFor: readOnly })).forTurn(fakeTurn());

    expect(seen).toEqual([{ pet: FAKE_TURN_PET, ids: ALL_TWELVE }]);
    expect(turn.definitions.map((definition) => definition.name)).not.toContain('remember');
    expect(turn.definitions.map((definition) => definition.name)).not.toContain('watch_for');

    const outcome = await turn.run({ name: 'remember', input: { text: 'Likes tea.' } });
    expect(outcome.isError).toBe(true);
    expect(memory.saved).toEqual([]);
  });
});
