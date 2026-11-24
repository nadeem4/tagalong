/** Tests for parseBodiesState: the brain's bodies and WhatsApp status as Home reads it. */
import { describe, expect, it } from 'vitest';
import { parseBodiesState } from './bodies';

const WIRE = {
  bodies: [
    { id: 'desktop-a1b2c3', kind: 'desktop', name: 'Desk', connected: true },
    { id: 'browser', kind: 'browser', name: 'Browser', connected: false },
    { id: 'whatsapp', kind: 'whatsapp', name: 'WhatsApp', connected: false },
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

  it('keeps the id of a body row, and the paired device behind it when there is one', () => {
    const state = parseBodiesState({
      ...WIRE,
      bodies: [{ ...WIRE.bodies[0]!, device_id: 'dev-1' }, ...WIRE.bodies.slice(1)],
    });
    expect(state.bodies.map((b) => b.id)).toEqual(['desktop-a1b2c3', 'browser', 'whatsapp']);
    expect(state.bodies.map((b) => b.device_id)).toEqual(['dev-1', undefined, undefined]);
  });

  it('rejects a state with a missing field', () => {
    const { port: _port, ...rest } = WIRE.whatsapp;
    expect(() => parseBodiesState({ ...WIRE, whatsapp: rest })).toThrow();
    expect(() =>
      parseBodiesState({ ...WIRE, bodies: [{ id: 'tv', kind: 'tv', name: 'x', connected: true }] }),
    ).toThrow();
  });
});
