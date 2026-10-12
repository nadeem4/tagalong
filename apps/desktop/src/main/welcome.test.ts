import { describe, expect, it } from 'vitest';
import { Pet, Settings } from '@tagalong/protocol';
import type { Role } from '@tagalong/protocol';
import { findAgents, shouldOpenWelcome, welcomeCrew } from './welcome';

const pet = (id: string, extra: Partial<Pet> = {}): Pet =>
  Pet.parse({
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    avatar: '🐾',
    roleId: 'generalist',
    roleVersion: 1,
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
      roleVersion: 3,
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
