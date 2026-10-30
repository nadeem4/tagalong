/**
 * Tests for the alarm's redial rule: it must not redial an outdated body, since the brain
 * refuses it every time and the popup would flicker between states.
 */
import { describe, expect, it } from 'vitest';
import { shouldRedial } from './reconnect';

describe('shouldRedial', () => {
  it.each([
    ['offline', true],
    ['connecting', true],
    ['online', false],
    ['outdated', false],
  ] as const)('%s redials: %s', (status, expected) => {
    expect(shouldRedial(status)).toBe(expected);
  });
});
