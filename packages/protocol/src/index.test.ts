/** Tests for the protocol version, the engine address constants and engineUrl. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_PORT, ENGINE_HOST, PROTOCOL_VERSION, engineUrl } from './index';

describe('protocol constants', () => {
  it('exposes a semver protocol version', () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('binds to loopback only', () => {
    expect(ENGINE_HOST).toBe('127.0.0.1');
  });
});

describe('engineUrl', () => {
  it('defaults to the standard engine port', () => {
    expect(engineUrl()).toBe(`ws://127.0.0.1:${DEFAULT_ENGINE_PORT}`);
  });

  it('honours an explicit port', () => {
    expect(engineUrl(50000)).toBe('ws://127.0.0.1:50000');
  });
});
