/** Tests for ToolRegistry.forTurn and toolsFor: which tools a turn gets, and dispatch. */
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
import { ROLE_LIBRARY } from '../roles/library.generated';
import { SETTINGS_DEFAULTS, Settings } from '@tagalong/protocol';

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
    history: {
      history: { search: () => [] },
      activity: { since: () => [] },
      sightLog: { list: () => [] },
      days: () => 7,
    },
    changeSettings: { get: () => Settings.parse(SETTINGS_DEFAULTS), emit: () => undefined },
    jobs: {
      jobs: {
        start: () => ({ ok: false, reason: 'empty' }),
        stop: () => false,
        result: () => null,
      },
      board: () => [],
      entry: () => null,
      cancelHandoff: () => false,
      stopWatch: () => false,
    },
    self: {
      list: () => [],
      read: () => '',
      write: () => ({ ok: true as const, versionId: 1, proposed: false, clipped: false }),
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
  'search_history',
  'change_settings',
  'forget',
  'work_on_it',
  'board',
  'open_result',
  'stop_work',
  'self_read',
  'self_write',
];

const ROUTINE = { routineId: 'r', name: 'Routine', handedOff: () => undefined };

/** One connected app with a read tool and a write tool. */
const APP = {
  tools: () =>
    ['search', 'create'].map((name) => ({
      connection: {
        id: 'notion',
        name: 'Notion',
        transport: { type: 'http' as const, url: 'https://example.com/mcp' },
        auth: 'oauth' as const,
        secretNames: [],
        enabled: true,
      },
      tool: {
        name,
        access: name === 'search' ? ('read' as const) : ('write' as const),
        risk: name === 'search' ? ('read' as const) : ('change' as const),
        inputSchema: { type: 'object' },
      },
    })),
  call: () => Promise.resolve({ ok: true as const, text: '' }),
  confirm: () => Promise.resolve('approved' as const),
  record: () => undefined,
};

describe('ToolRegistry on background turns', () => {
  it('offers only board and open_result of the job tools on a routine’s turn', () => {
    const names = new ToolRegistry(everything())
      .forTurn(fakeTurn({ routine: ROUTINE }))
      .definitions.map((definition) => definition.name);
    expect(names).toContain('board');
    expect(names).toContain('open_result');
    expect(names).not.toContain('work_on_it');
    expect(names).not.toContain('stop_work');
  });

  it('never offers or runs self_write on a routine’s turn: nobody is there to own the change', async () => {
    const turn = new ToolRegistry(everything()).forTurn(fakeTurn({ routine: ROUTINE }));
    const names = turn.definitions.map((definition) => definition.name);
    expect(names).toContain('self_read');
    expect(names).not.toContain('self_write');
    const refused = await turn.run({
      name: 'self_write',
      input: { path: 'you.md', text: 'x', why: 'y' },
    });
    expect(refused.isError).toBe(true);
  });

  it('gives a job’s turn only search_history and the apps’ read tools', async () => {
    const turn = new ToolRegistry(everything({ connections: APP })).forTurn(
      fakeTurn({ job: { jobId: 'j1' } }),
    );
    expect(turn.definitions.map((definition) => definition.name)).toEqual([
      'notion__search',
      'search_history',
    ]);
    const refused = await turn.run({ name: 'work_on_it', input: { task: 'again' } });
    expect(refused.isError).toBe(true);
  });
});

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

    expect(writes).toEqual([
      'remember',
      'watch_for',
      'change_settings',
      'forget',
      'work_on_it',
      'stop_work',
      'self_write',
    ]);
    expect(tools.filter((tool) => tool.kind === 'read')).toHaveLength(15);
  });

  it('gives a companion its tools, then the routine tools (write), point_at, search_history, change_settings, forget and the job tools', () => {
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
            plugins: [],
            mcpTools: [],
            workspace: 'project' as const,
          },
        },
      ],
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
      'search_history',
      'change_settings',
      'forget',
      'work_on_it',
      'board',
      'open_result',
      'stop_work',
      'self_read',
      'self_write',
    ]);
    for (const id of ['hand_to_expert', 'create_routine', 'change_routine', 'change_settings']) {
      expect(tools.find((tool) => tool.id === id)?.kind).toBe('write');
    }
  });

  it('gives no role a tool that can answer an ask: only a click does (floor 12)', () => {
    // No tool is wired to the asks at all.
    expect(Object.keys(everything({ connections: APP }))).not.toContain('asks');
    for (const role of ROLE_LIBRARY) {
      const ids = new ToolRegistry(everything({ connections: APP, toolsFor }))
        .forTurn(fakeTurn({ pet: { ...FAKE_TURN_PET, roleId: role.id } }))
        .tools.map((tool) => tool.id);
      for (const id of ids) expect(id).not.toMatch(/approve|answer/i);
    }
  });

  it('offers tell_expert just before change_settings, and only while a hand-off is running', () => {
    const base = {
      experts: () => [],
      propose: () => ({ proposalId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
      steer: () => ({ ok: true as const }),
    };
    const run = {
      handoffId: '0b6f0c4e-1111-4222-8333-444455556666',
      expertId: 'claude-code',
      expertName: 'Claude Code',
      ask: 'x',
    };
    const ids = (running: (typeof run)[]) =>
      new ToolRegistry(everything({ experts: { ...base, running: () => running } }))
        .forTurn(fakeTurn())
        .tools.map((tool) => tool.id);
    expect(ids([])).toEqual(ALL_TOOLS);
    expect(ids([run])).toEqual([...ALL_TOOLS.slice(0, -8), 'tell_expert', ...ALL_TOOLS.slice(-8)]);
  });

  it('builds only what is wired: no perception options, no perception tools', () => {
    const turn = new ToolRegistry({ memory: fakeMemory() }).forTurn(fakeTurn());
    expect(turn.tools.map((tool) => tool.id)).toEqual(['remember', 'forget']);
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
    expect(memory.saved).toEqual([{ petId: FAKE_TURN_PET.id, kind: 'fact', text: 'Likes tea.' }]);
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
      fakeTurn({ routine: { routineId: 'r', name: 'Routine', handedOff: () => undefined } }),
    );
    expect(turn.definitions.map((definition) => definition.name)).not.toContain('watch_for');
    const outcome = await turn.run({ name: 'watch_for', input: { condition: 'a build ends' } });
    expect(outcome.isError).toBe(true);
  });

  it('still offers change_settings on a routine’s turn: the tool refuses loosening there', () => {
    const turn = new ToolRegistry(everything()).forTurn(
      fakeTurn({ routine: { routineId: 'r', name: 'Routine', handedOff: () => undefined } }),
    );
    expect(turn.definitions.map((definition) => definition.name)).toContain('change_settings');
  });

  it('never offers watch_for to the companion on a routine’s turn, though its role lists it', () => {
    const turn = new ToolRegistry(everything({ toolsFor })).forTurn(
      fakeTurn({
        pet: { ...FAKE_TURN_PET, roleId: 'companion' },
        routine: { routineId: 'r', name: 'Routine', handedOff: () => undefined },
      }),
    );
    expect(companion.tools).toContain('watch_for');
    expect(turn.definitions.map((definition) => definition.name)).not.toContain('watch_for');
  });

  it('gives no tool the role does not list', () => {
    const pet: Pet = { ...FAKE_TURN_PET, roleId: 'companion' };
    const tools = new ToolRegistry(everything()).forTurn(fakeTurn({ pet })).tools;
    const outside = { ...tools[0]!, id: 'write_file' };
    expect(toolsFor(pet, [...tools, outside]).map((tool) => tool.id)).not.toContain('write_file');
  });

  it("gives a pet with a role the library does not have the companion's tools", () => {
    // A role id the library no longer has, as an older saved pet may hold.
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
