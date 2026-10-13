import { describe, expect, it } from 'vitest';
import { brainLabel, modelLabel } from './brain-label';

describe('modelLabel', () => {
  it('names the Claude sign-in models the way people say them', () => {
    expect(modelLabel('claude-code', 'haiku')).toBe('Haiku');
    expect(modelLabel('claude-code', 'sonnet')).toBe('Sonnet');
  });

  it('leaves a service model id exactly as it is', () => {
    expect(modelLabel('openrouter', 'anthropic/claude-haiku-4.5')).toBe(
      'anthropic/claude-haiku-4.5',
    );
  });
});

describe('brainLabel', () => {
  it('joins the service and the model', () => {
    expect(brainLabel('Your Claude sign-in', 'claude-code', 'haiku')).toBe(
      'Your Claude sign-in · Haiku',
    );
    expect(brainLabel('OpenRouter', 'openrouter', 'anthropic/claude-haiku-4.5')).toBe(
      'OpenRouter · anthropic/claude-haiku-4.5',
    );
  });
});
