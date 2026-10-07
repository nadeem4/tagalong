import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextSnapshot } from '@tagalong/protocol';
import type { TurnEvent } from '@tagalong/ui';
import { createPortBridge } from './port-bridge';
import type { PageMessage, PortLike, WorkerMessage } from './port-messages';

const SNAPSHOT: ContextSnapshot = {
  id: '6f1c2f0e-2a4b-4c1d-9e8f-0a1b2c3d4e5f',
  capturedAt: '2026-10-04T00:00:00.000Z',
  host: 'extension',
  selection: 'the exact words',
};

/** The page's end of a port, with the worker's replies driven by the test. */
function fakePort() {
  const listeners: ((message: unknown) => void)[] = [];
  const disconnects: (() => void)[] = [];
  const sent: PageMessage[] = [];
  return {
    sent,
    port: {
      postMessage: (message: unknown) => sent.push(message as PageMessage),
      onMessage: { addListener: (l: (message: unknown) => void) => listeners.push(l) },
      onDisconnect: { addListener: (l: () => void) => disconnects.push(l) },
    } satisfies PortLike,
    deliver: (message: WorkerMessage) => listeners.forEach((l) => l(message)),
    disconnect: () => disconnects.forEach((l) => l()),
  };
}

/** Answers the newest request of a kind the way the service worker would. */
function reply(p: ReturnType<typeof fakePort>, result: unknown, ok = true): void {
  const last = p.sent.filter((m) => m.type !== 'ping').at(-1) as { id: number };
  p.deliver(
    ok
      ? { type: 'reply', id: last.id, ok: true, result }
      : { type: 'reply', id: last.id, ok: false, error: String(result) },
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createPortBridge', () => {
  it('asks the engine with the pet, the text and the attached snapshot', async () => {
    const p = fakePort();
    const bridge = createPortBridge(p.port);
    const asked = bridge.ask({ petId: 'pip', text: 'what is this?', snapshot: SNAPSHOT });
    expect(p.sent.at(-1)).toEqual({
      type: 'call',
      id: 1,
      method: 'ask',
      params: { petId: 'pip', input: { text: 'what is this?' }, snapshot: SNAPSHOT },
    });
    reply(p, { turnId: 't-1' });
    await expect(asked).resolves.toEqual({ turnId: 't-1' });
  });

  it('rejects with the worker’s reason, so the panel can say the app is not running', async () => {
    const p = fakePort();
    const bridge = createPortBridge(p.port);
    const asked = bridge.ask({ petId: 'pip', text: 'hi' });
    reply(p, 'not connected to the Tagalong app (disconnected)', false);
    await expect(asked).rejects.toThrow('not connected to the Tagalong app');
  });

  it('captures the tab through the worker', async () => {
    const p = fakePort();
    const bridge = createPortBridge(p.port);
    const captured = bridge.capture(['selection', 'pageText']);
    expect(p.sent.at(-1)).toMatchObject({ type: 'capture', targets: ['selection', 'pageText'] });
    reply(p, SNAPSHOT);
    await expect(captured).resolves.toEqual(SNAPSHOT);
  });

  it('lists pets and interrupts through engine calls', async () => {
    const p = fakePort();
    const bridge = createPortBridge(p.port);
    const pets = bridge.listPets();
    expect(p.sent.at(-1)).toMatchObject({ method: 'pets.list' });
    reply(p, { pets: [] });
    await expect(pets).resolves.toEqual([]);

    const stopped = bridge.interrupt('t-1');
    expect(p.sent.at(-1)).toMatchObject({ method: 'interrupt', params: { turnId: 't-1' } });
    reply(p, { aborted: true });
    await expect(stopped).resolves.toBeUndefined();
  });

  it('lists roles and asks for a recommended model through engine calls', async () => {
    const p = fakePort();
    const bridge = createPortBridge(p.port);
    const roles = bridge.listRoles();
    expect(p.sent.at(-1)).toMatchObject({ method: 'roles.list', params: {} });
    reply(p, { roles: [] });
    await expect(roles).resolves.toEqual([]);

    const recommended = bridge.recommendModel('writer', 'nebius');
    expect(p.sent.at(-1)).toMatchObject({
      method: 'roles.recommendModel',
      params: { roleId: 'writer', providerId: 'nebius' },
    });
    reply(p, { model: 'nemotron' });
    await expect(recommended).resolves.toEqual({ model: 'nemotron' });
  });

  it('turns turn and crew notifications into the events the chat panel consumes', () => {
    const p = fakePort();
    const bridge = createPortBridge(p.port);
    const events: TurnEvent[] = [];
    const stop = bridge.onTurnEvent((event) => events.push(event));
    p.deliver({ type: 'notification', method: 'turn.delta', params: { turnId: 't', text: 'Hi' } });
    p.deliver({
      type: 'notification',
      method: 'pet.message',
      params: { fromPetId: 'scout', toPetId: 'ink', kind: 'handoff', text: 'over' },
    });
    stop();
    p.deliver({ type: 'notification', method: 'turn.delta', params: { turnId: 't', text: '!' } });
    expect(events).toEqual([
      { type: 'turn.delta', turnId: 't', text: 'Hi' },
      { type: 'pet.message', fromPetId: 'scout', toPetId: 'ink', kind: 'handoff', text: 'over' },
    ]);
  });

  it('reports connection status and shortcut context to their subscribers', () => {
    const p = fakePort();
    const bridge = createPortBridge(p.port);
    const statuses: string[] = [];
    const contexts: (ContextSnapshot | null)[] = [];
    bridge.onStatus((status) => statuses.push(status.state));
    bridge.onContext((snapshot) => contexts.push(snapshot));
    p.deliver({ type: 'status', status: { state: 'disconnected', reason: 'x', retryInMs: 1000 } });
    p.deliver({ type: 'context', snapshot: SNAPSHOT });
    expect(statuses).toEqual(['disconnected']);
    expect(contexts).toEqual([SNAPSHOT]);
  });

  it('replays the last status to a late subscriber', () => {
    const p = fakePort();
    const bridge = createPortBridge(p.port);
    p.deliver({ type: 'status', status: { state: 'unpaired' } });
    const statuses: string[] = [];
    bridge.onStatus((status) => statuses.push(status.state));
    expect(statuses).toEqual(['unpaired']);
  });

  it('pings the worker while open, which keeps Chrome from stopping it', () => {
    const p = fakePort();
    createPortBridge(p.port);
    vi.advanceTimersByTime(20_000);
    expect(p.sent).toContainEqual({ type: 'ping' });
  });

  it('fails everything in flight when the worker goes away', async () => {
    const p = fakePort();
    const bridge = createPortBridge(p.port);
    const asked = bridge.ask({ petId: 'pip', text: 'hi' });
    p.disconnect();
    await expect(asked).rejects.toThrow(/extension restarted/);
  });
});
