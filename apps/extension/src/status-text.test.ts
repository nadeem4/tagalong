/** Tests for describeStatus. */
import { describe, expect, it } from 'vitest';
import { describeStatus } from './status-text';

describe('describeStatus', () => {
  it('says the desktop app is needed when disconnected, and when it will retry', () => {
    expect(
      describeStatus({
        state: 'disconnected',
        reason: 'could not reach the Tagalong app',
        retryInMs: 4_000,
      }),
    ).toBe(
      'Disconnected: could not reach the Tagalong app. Retrying in 4s. Is the Tagalong app running?',
    );
  });

  it('points an unpaired user at the options page', () => {
    expect(describeStatus({ state: 'unpaired' })).toMatch(/pairing token/);
  });

  it('names the engine version once connected', () => {
    expect(describeStatus({ state: 'connected', engineVersion: '1.2.3', pets: [] })).toBe(
      'Connected to Tagalong 1.2.3.',
    );
  });
});
