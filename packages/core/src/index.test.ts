/** Tests for the package entry: the role helpers it re-exports. */
import { describe, expect, it } from 'vitest';
import { getRole, recommendedModel } from './index';

describe('role helpers', () => {
  it('are exported for hosts: a lookup and the recommended model', () => {
    const companion = getRole('companion');
    expect(companion?.name).toBe('Companion');
    expect(recommendedModel(companion!, 'anthropic')?.model).toBe('claude-sonnet-5');
  });
});
