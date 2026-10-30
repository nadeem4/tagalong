/** Tests for createFakeHostBridge's recorded calls and seeded data. */

import { describe, expect, it } from 'vitest';
import type { TurnEvent } from '../host-bridge';
import { createFakeHostBridge } from './fake-host-bridge';

describe('createFakeHostBridge', () => {
  it('records every ask and answers with a fresh turn id', async () => {
    const bridge = createFakeHostBridge();

    const first = await bridge.ask({ petId: 'scout', text: 'hello' });
    const second = await bridge.ask({ petId: 'scout', text: 'again' });

    expect(first.turnId).not.toBe(second.turnId);
    expect(bridge.asks).toEqual([
      { petId: 'scout', text: 'hello' },
      { petId: 'scout', text: 'again' },
    ]);
  });

  it('delivers emitted turn events until the subscriber unsubscribes', () => {
    const bridge = createFakeHostBridge();
    const seen: TurnEvent[] = [];

    const unsubscribe = bridge.onTurnEvent((event) => seen.push(event));
    bridge.emit({ type: 'turn.delta', turnId: 't1', text: 'a' });
    unsubscribe();
    bridge.emit({ type: 'turn.delta', turnId: 't1', text: 'b' });

    expect(seen).toEqual([{ type: 'turn.delta', turnId: 't1', text: 'a' }]);
  });

  it('lists the pets it was seeded with and records interrupts', async () => {
    const bridge = createFakeHostBridge({
      pets: [{ id: 'scout', name: 'Scout', avatar: '🦊' }],
    });

    await expect(bridge.listPets()).resolves.toHaveLength(1);
    await bridge.interrupt('t1');
    expect(bridge.interrupts).toEqual(['t1']);
  });
});
