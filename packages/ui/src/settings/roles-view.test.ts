import { describe, expect, it } from 'vitest';
import type { Role } from '@tagalong/protocol';
import { FIXTURE_ROLES } from '../test-support/fixture-roles';
import { brainLabel, reachableTools, toolLabel } from './roles-view';

const [generalist, backend] = FIXTURE_ROLES as [Role, Role];

describe('toolLabel', () => {
  it('names a read tool in words and says it only reads', () => {
    expect(toolLabel('look_at_screen')).toEqual({
      label: 'Look at the screen',
      what: 'reads only',
    });
  });

  it('says remember saves a memory and watch_for starts a watch', () => {
    expect(toolLabel('remember').what).toBe('saves a memory');
    expect(toolLabel('watch_for').what).toBe('starts a watch');
  });

  it('falls back to the id for a tool it does not know', () => {
    expect(toolLabel('mystery_tool')).toEqual({ label: 'mystery_tool', what: 'reads only' });
  });
});

describe('reachableTools', () => {
  it('lists the role tools the grants leave on, in role order', () => {
    expect(reachableTools(backend, { watch_for: 'off' })).toEqual(['read_window_text', 'remember']);
  });

  it('ignores a grant for a tool the role does not list', () => {
    expect(reachableTools(generalist, { watch_for: 'allowed' })).toEqual(generalist.tools);
  });
});

describe('brainLabel', () => {
  it('is the role tier when the model is the recommended one', () => {
    expect(brainLabel(backend, 'opus', 'opus')).toBe('deep');
  });

  it('is custom when the model is anything else, or nothing is recommended', () => {
    expect(brainLabel(backend, 'haiku', 'opus')).toBe('custom');
    expect(brainLabel(backend, 'opus', undefined)).toBe('custom');
  });
});
