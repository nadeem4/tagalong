/** Tests for parseModelState: the brain's model_state answer as Settings reads it. */
import { describe, expect, it } from 'vitest';
import { parseModelState } from './model';

const WIRE = {
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  default: 'claude-opus-5-5',
  models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', line: 'Most capable' }],
};

describe('parseModelState', () => {
  it('reads the state as sent', () => {
    expect(parseModelState(WIRE)).toEqual(WIRE);
  });

  it('refuses a state with no models', () => {
    expect(() => parseModelState({ ...WIRE, models: [] })).toThrow();
  });
});
