/** Tests for parseBodiesState: the brain's bodies and WhatsApp status as Home reads it. */
import { describe, expect, it } from 'vitest';
import { parseBodiesState } from './bodies';

const WIRE = {
  bodies: [
    { kind: 'desktop', name: 'Desktop', connected: true },
    { kind: 'browser', name: 'Browser', connected: false },
    { kind: 'whatsapp', name: 'WhatsApp', connected: false },
  ],
  whatsapp: {
    enabled: false,
    set: {
      access_token: true,
      app_secret: true,
      verify_token: false,
      phone_number_id: true,
      allowed_number: true,
    },
    complete: false,
    state: 'incomplete',
    port: 47322,
  },
};

describe('parseBodiesState', () => {
  it('reads the merged state and renames the keys to camel case', () => {
    const state = parseBodiesState(WIRE);
    expect(state.bodies).toHaveLength(3);
    expect(state.whatsapp.set).toEqual({
      accessToken: true,
      appSecret: true,
      verifyToken: false,
      phoneNumberId: true,
      allowedNumber: true,
    });
    expect(state.whatsapp).toMatchObject({ enabled: false, complete: false, port: 47322 });
  });

  it('rejects a state with a missing field', () => {
    const { port: _port, ...rest } = WIRE.whatsapp;
    expect(() => parseBodiesState({ ...WIRE, whatsapp: rest })).toThrow();
    expect(() =>
      parseBodiesState({ ...WIRE, bodies: [{ kind: 'tv', name: 'x', connected: true }] }),
    ).toThrow();
  });
});
