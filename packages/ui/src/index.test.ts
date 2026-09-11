import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@tagalong/protocol';
import { UI_PROTOCOL_VERSION } from './index';

describe('ui package', () => {
  it('tracks the shared protocol version', () => {
    expect(UI_PROTOCOL_VERSION).toBe(PROTOCOL_VERSION);
  });
});
