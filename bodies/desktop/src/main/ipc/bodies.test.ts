/**
 * Tests for the bodies IPC: Home's state and WhatsApp setup go through the brain's tools, and no
 * reply or error carries a pasted secret back.
 */

import { RpcError } from '@tagalong/contract';
import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { registerBodiesIpc } from './bodies';
import { fakeIpc } from './fake-ipc';

const TOKEN = 'EAAG-fake-access-token-value';
const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

const BODIES = { bodies: [{ kind: 'desktop', name: 'Desktop', connected: true }] };
const WHATSAPP = {
  enabled: false,
  set: {
    access_token: false,
    app_secret: false,
    verify_token: false,
    phone_number_id: false,
    allowed_number: false,
  },
  complete: false,
  state: 'off',
  port: 47322,
};

function setup(answer: (tool: string, input?: object) => unknown) {
  const ipc = fakeIpc();
  const calls: [string, object | undefined][] = [];
  const brain = {
    call: (tool: string, input?: object) => {
      calls.push([tool, input]);
      try {
        return Promise.resolve(answer(tool, input)) as Promise<never>;
      } catch (error) {
        return Promise.reject(error as Error);
      }
    },
  };
  registerBodiesIpc(ipc.handle, { brain });
  return { ...ipc, calls };
}

const normal = (tool: string) => text(tool === 'bodies_status' ? BODIES : WHATSAPP);

describe('registerBodiesIpc', () => {
  it('merges both status tools into one state', async () => {
    const { invoke, calls } = setup(normal);
    const state = (await invoke(IPC.bodiesState)) as {
      bodies: unknown[];
      whatsapp: { port: number };
    };
    expect(state.bodies).toHaveLength(1);
    expect(state.whatsapp.port).toBe(47322);
    expect(calls.map(([tool]) => tool).sort()).toEqual(['bodies_status', 'whatsapp_status']);
  });

  it('maps camel case to the brain arguments', async () => {
    const { invoke, calls } = setup(normal);
    await invoke(IPC.whatsappSet, {
      enabled: true,
      accessToken: TOKEN,
      appSecret: 's',
      verifyToken: 'v',
      phoneNumberId: '123',
      allowedNumber: '4477',
      port: 50000,
    });
    expect(calls).toEqual([
      [
        'whatsapp_set',
        {
          enabled: true,
          access_token: TOKEN,
          app_secret: 's',
          verify_token: 'v',
          phone_number_id: '123',
          allowed_number: '4477',
          port: 50000,
        },
      ],
    ]);
  });

  it('sends only the keys it was given', async () => {
    const { invoke, calls } = setup(normal);
    await invoke(IPC.whatsappSet, { enabled: false });
    expect(calls).toEqual([['whatsapp_set', { enabled: false }]]);
  });

  it('never lets a bad argument reach the brain', async () => {
    const { invoke, calls } = setup(normal);
    const bad = [null, 'x', { enabled: 'yes' }, { accessToken: 5 }, { port: 1.5 }, { extra: 1 }];
    for (const arg of bad) await expect(invoke(IPC.whatsappSet, arg)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('never carries the pasted secret in an error', async () => {
    for (const thrown of [new Error(`failed with ${TOKEN}`), new RpcError(-1, `bad ${TOKEN}`)]) {
      const { invoke } = setup(() => {
        throw thrown;
      });
      const err = (await invoke(IPC.whatsappSet, { accessToken: TOKEN }).catch(
        (e: unknown) => e,
      )) as Error;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).not.toContain(TOKEN);
      expect(err.cause).toBeUndefined();
    }
  });
});
