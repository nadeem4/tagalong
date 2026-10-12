import { describe, expect, it } from 'vitest';
import type { FoundAgent, ProviderChoice } from '../../shared/ipc';
import { brainOptions, canStart, defaultBrain } from './welcome-flow';

const agents = (claudeFound: boolean): FoundAgent[] => [
  { id: 'claude-code', label: 'Claude Code', found: claudeFound, canThink: true },
  { id: 'gemini-cli', label: 'Gemini CLI', found: true, canThink: false },
];

const providers = (stored: string[] = []): ProviderChoice[] => [
  {
    id: 'claude-code',
    label: 'Claude Code (your sign-in, no key)',
    needsKey: false,
    hasKey: false,
  },
  { id: 'openrouter', label: 'OpenRouter', needsKey: true, hasKey: stored.includes('openrouter') },
  { id: 'anthropic', label: 'Anthropic', needsKey: true, hasKey: stored.includes('anthropic') },
  { id: 'fake', label: 'Fake (offline demo)', needsKey: false, hasKey: false },
];

describe('brainOptions', () => {
  it('offers the Claude Code sign-in first when Claude Code is here, then the keyed providers', () => {
    const options = brainOptions(agents(true), providers());
    expect(options.map((option) => option.id)).toEqual(['claude-code', 'openrouter', 'anthropic']);
  });

  it('leaves the sign-in out when Claude Code is not installed, and never offers the fake', () => {
    const options = brainOptions(agents(false), providers());
    expect(options.map((option) => option.id)).toEqual(['openrouter', 'anthropic']);
  });
});

describe('defaultBrain', () => {
  it('picks the Claude Code sign-in when it is here: nothing to type', () => {
    expect(defaultBrain(brainOptions(agents(true), providers(['anthropic'])))).toBe('claude-code');
  });

  it('otherwise picks a provider whose key is already stored', () => {
    expect(defaultBrain(brainOptions(agents(false), providers(['anthropic'])))).toBe('anthropic');
  });

  it('otherwise the first keyed provider', () => {
    expect(defaultBrain(brainOptions(agents(false), providers()))).toBe('openrouter');
  });
});

describe('canStart', () => {
  const options = brainOptions(agents(true), providers(['anthropic']));

  it('starts on the sign-in, or on a provider with a stored key, with nothing typed', () => {
    expect(canStart(options, 'claude-code', '')).toBe(true);
    expect(canStart(options, 'anthropic', '')).toBe(true);
  });

  it('waits for a key on a provider that has none', () => {
    expect(canStart(options, 'openrouter', '  ')).toBe(false);
    expect(canStart(options, 'openrouter', 'sk-or-1')).toBe(true);
  });
});
