import { describe, expect, it, vi } from 'vitest';
import { Pet, Settings } from '@tagalong/protocol';
import type { Role } from '@tagalong/protocol';
import {
  companionOn,
  LISTENING_LINE,
  findAgents,
  launchLine,
  shouldGreetOnLaunch,
  shouldOpenWelcome,
  welcomeCrew,
  welcomeExperts,
} from './welcome';

const pet = (id: string, extra: Partial<Pet> = {}): Pet =>
  Pet.parse({
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    avatar: '🐾',
    roleId: 'companion',
    model: 'anthropic/claude-haiku-4.5',
    providerId: 'openrouter',
    ...extra,
  });

const COMPANION: Role = {
  id: 'companion',
  name: 'Companion',
  version: 3,
  summary: 'Routes work to experts.',
  goodAt: [],
  notFor: [],
  tools: [],
  model: { tier: 'fast', needsVision: false },
  instructions: 'You route.',
};

describe('findAgents', () => {
  it('lists the coding agents in order, saying which are on this computer', async () => {
    const onPath = new Set(['claude', 'codex']);
    const agents = await findAgents(async (command) => onPath.has(command));
    expect(agents).toEqual([
      { id: 'claude-code', label: 'Claude Code', found: true, canThink: true },
      { id: 'gemini-cli', label: 'Gemini CLI', found: false, canThink: false },
      { id: 'codex', label: 'Codex', found: true, canThink: false },
    ]);
  });

  it('treats a failed lookup as not found', async () => {
    const agents = await findAgents(async () => {
      throw new Error('where.exe is missing');
    });
    expect(agents.every((agent) => !agent.found)).toBe(true);
  });
});

describe('shouldOpenWelcome', () => {
  it('opens until Welcome is finished, even after the old wizard was', () => {
    expect(shouldOpenWelcome(Settings.parse({ onboarding: { done: true } }), {})).toBe(true);
    expect(shouldOpenWelcome(Settings.parse({ welcome: { done: true } }), {})).toBe(false);
  });

  it('stays shut for the end-to-end smoke test', () => {
    expect(shouldOpenWelcome(Settings.parse({}), { TAGALONG_SKIP_ONBOARDING: '1' })).toBe(false);
  });
});

describe('shouldGreetOnLaunch', () => {
  it('greets on every launch after Welcome, by default', () => {
    expect(shouldGreetOnLaunch(Settings.parse({ welcome: { done: true } }))).toBe(true);
  });

  it('stays quiet before Welcome is done: the intro after Welcome is the first hello', () => {
    expect(shouldGreetOnLaunch(Settings.parse({}))).toBe(false);
  });

  it('stays quiet when the greeting is switched off', () => {
    expect(shouldGreetOnLaunch(Settings.parse({ welcome: { done: true }, greeting: false }))).toBe(
      false,
    );
  });
});

describe('launchLine', () => {
  it('says Scout is listening and how to stop, when Always listening is on, even with the greeting off', async () => {
    expect(LISTENING_LINE).toBe(
      'I’m listening. Say “Scout, stop”, or switch off Always listening in my bubble.',
    );
    for (const greeting of [true, false]) {
      const compose = vi.fn(async () => ({ text: 'Morning.' }));
      const settings = Settings.parse({
        welcome: { done: true },
        greeting,
        listening: { always: true },
      });
      expect(await launchLine(settings, compose)).toEqual({ text: LISTENING_LINE });
      expect(compose).not.toHaveBeenCalled();
    }
  });

  it('says the composed greeting when listening is off and the greeting is allowed', async () => {
    const compose = vi.fn(async () => ({ text: 'Morning.' }));
    expect(await launchLine(Settings.parse({ welcome: { done: true } }), compose)).toEqual({
      text: 'Morning.',
    });
    expect(compose).toHaveBeenCalledOnce();
  });

  it('says nothing when listening is off and the greeting is switched off', async () => {
    const compose = vi.fn(async () => ({ text: 'Morning.' }));
    const settings = Settings.parse({ welcome: { done: true }, greeting: false });
    expect(await launchLine(settings, compose)).toBeNull();
    expect(compose).not.toHaveBeenCalled();
  });
});

describe('welcomeCrew', () => {
  it('makes Scout the Companion on the chosen brain, and docks Scout alone', () => {
    const crew = [
      pet('scout', { visionModel: 'nvidia/Nemotron-Nano-V2-12b', watchModel: 'x' }),
      pet('ink'),
      pet('bolt'),
    ];
    const { scout, hiddenPets } = welcomeCrew(crew, 'scout', 'claude-code', COMPANION);
    expect(scout).toMatchObject({
      id: 'scout',
      roleId: 'companion',
      providerId: 'claude-code',
      model: 'haiku',
    });
    expect(scout.visionModel).toBeUndefined();
    expect(scout.watchModel).toBeUndefined();
    expect(hiddenPets).toEqual(['ink', 'bolt']);
  });

  it('picks the role tier’s model on a keyed provider', () => {
    const { scout } = welcomeCrew([pet('scout')], 'scout', 'anthropic', COMPANION);
    expect(scout).toMatchObject({ providerId: 'anthropic', model: 'claude-haiku-4-5' });
  });

  it('refuses a crew without the default pet', () => {
    expect(() => welcomeCrew([pet('ink')], 'scout', 'claude-code', COMPANION)).toThrow(/no scout/);
  });
});

describe('companionOn', () => {
  it('moves Scout to a keyed service on its recommended model, dropping old vision and watch models', () => {
    const scout = companionOn(
      pet('scout', {
        roleId: 'companion',
        providerId: 'claude-code',
        model: 'haiku',
        watchModel: 'x',
      }),
      'openrouter',
      COMPANION,
    );
    expect(scout).toMatchObject({ id: 'scout', providerId: 'openrouter', roleId: 'companion' });
    expect(scout.model).not.toBe('haiku');
    expect(scout.watchModel).toBeUndefined();
  });
});

describe('welcomeExperts', () => {
  const found = (claude: boolean) => [
    { id: 'claude-code', label: 'Claude Code', found: claude, canThink: true },
    { id: 'codex', label: 'Codex', found: true, canThink: false },
  ];

  it('adds Claude Code as an expert when it is installed, with no folder: each task picks one', () => {
    expect(welcomeExperts(found(true), [])).toEqual([
      {
        id: 'claude-code',
        name: 'Claude Code',
        goodAt: 'Code: reading, explaining, debugging and changing code in a project.',
        enabled: true,
        instructions: '',
        connection: { type: 'claude-code', canEdit: false, canSearchWeb: false },
      },
    ]);
  });

  it('adds nothing when Claude Code is missing or already an expert', () => {
    expect(welcomeExperts(found(false), [])).toEqual([]);
    expect(
      welcomeExperts(found(true), [
        {
          id: 'my-claude',
          name: 'Mine',
          goodAt: '',
          enabled: true,
          instructions: '',
          connection: { type: 'claude-code', canEdit: true, canSearchWeb: false },
        },
      ]),
    ).toEqual([]);
  });
});
