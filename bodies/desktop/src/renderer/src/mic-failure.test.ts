/** Tests for micFailure. */
import { describe, expect, it } from 'vitest';
import { micFailure } from './mic-failure';

describe('micFailure', () => {
  it('reads a refused permission as denied, anything else as no microphone', () => {
    expect(micFailure({ name: 'NotAllowedError' })).toBe('denied');
    expect(micFailure({ name: 'SecurityError' })).toBe('denied');
    expect(micFailure({ name: 'NotFoundError' })).toBe('no-mic');
    expect(micFailure(new Error('x'))).toBe('no-mic');
  });

  it('reads a microphone another app holds as busy, not missing', () => {
    expect(micFailure({ name: 'NotReadableError' })).toBe('busy');
    expect(micFailure({ name: 'AbortError' })).toBe('busy');
    expect(micFailure({ name: 'OverconstrainedError' })).toBe('no-mic');
  });
});
