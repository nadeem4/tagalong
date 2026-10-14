import { describe, expect, it } from 'vitest';
import { Pet } from '@tagalong/protocol';
import type { ProviderChoice } from '../../../shared/ipc';
import { overviewStatus, scoutBrain } from './brain';

const providers: ProviderChoice[] = [
  { id: 'claude-code', label: 'Your Claude sign-in', needsKey: false, hasKey: false },
  { id: 'openrouter', label: 'OpenRouter', needsKey: true, hasKey: true },
  { id: 'anthropic', label: 'Anthropic', needsKey: true, hasKey: false },
];

const scout = (providerId: string, model: string): Pet =>
  Pet.parse({
    id: 'scout',
    name: 'Scout',
    avatar: '🦊',
    roleId: 'companion',
    roleVersion: 1,
    providerId,
    model,
  });

describe('scoutBrain', () => {
  it("reads Scout's own provider and model, and says it is signed in", () => {
    const brain = scoutBrain(scout('claude-code', 'haiku'), providers, 'signed-in');
    expect(brain).toMatchObject({
      state: 'ready',
      title: 'Your Claude sign-in · Haiku',
      chip: { text: 'Signed in', tone: 'ok' },
    });
  });

  it('says signed out, in words, when Claude Code is installed but not signed in', () => {
    const brain = scoutBrain(scout('claude-code', 'haiku'), providers, 'signed-out');
    expect(brain).toMatchObject({
      state: 'signed-out',
      chip: { text: 'Signed out', tone: 'warn' },
    });
    expect(brain.help).toMatch(/not signed in/);
  });

  it('asks for a key when Claude Code is not on this computer', () => {
    expect(scoutBrain(scout('claude-code', 'haiku'), providers, 'not-installed').state).toBe(
      'no-sign-in',
    );
  });

  it('says it is still checking, then that it could not check', () => {
    expect(scoutBrain(scout('claude-code', 'haiku'), providers, null).chip?.text).toBe('Checking…');
    expect(scoutBrain(scout('claude-code', 'haiku'), providers, 'unknown')).toMatchObject({
      state: 'unknown',
      chip: { text: 'Couldn’t check', tone: 'warn' },
    });
  });

  it('says whether a keyed service has its key, whatever the sign-in says', () => {
    expect(
      scoutBrain(scout('openrouter', 'anthropic/claude-haiku-4.5'), providers, 'not-installed'),
    ).toMatchObject({
      state: 'ready',
      title: 'OpenRouter · anthropic/claude-haiku-4.5',
      chip: { text: 'Key stored', tone: 'ok' },
    });
    expect(scoutBrain(scout('anthropic', 'claude-haiku-4-5'), providers, null)).toMatchObject({
      state: 'no-key',
      chip: { text: 'No key', tone: 'warn' },
    });
  });

  it('reports the engine as down when there is no Scout to read', () => {
    expect(scoutBrain(undefined, providers, 'signed-in').state).toBe('engine-down');
  });
});

describe('overviewStatus', () => {
  const brain = (providerId: string, signIn: 'signed-in' | 'signed-out' | null = 'signed-in') =>
    scoutBrain(scout(providerId, 'm'), providers, signIn);

  it('is Ready only when Scout can think and sees', () => {
    expect(overviewStatus(brain('claude-code'), false)).toEqual({ text: 'Ready', ok: true });
    expect(overviewStatus(brain('openrouter'), false)).toEqual({ text: 'Ready', ok: true });
  });

  it('says what stops Scout thinking, first', () => {
    expect(overviewStatus(brain('claude-code', 'signed-out'), true)).toEqual({
      text: 'Signed out of Claude Code',
      ok: false,
    });
    expect(overviewStatus(brain('anthropic'), false)).toEqual({ text: 'No API key', ok: false });
    expect(overviewStatus(scoutBrain(undefined, providers, null), false)).toEqual({
      text: 'Not running',
      ok: false,
    });
  });

  it('says when sight is paused', () => {
    expect(overviewStatus(brain('claude-code'), true)).toEqual({
      text: 'Ready, sight paused',
      ok: false,
    });
  });
});
