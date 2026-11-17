/** Tests for createFakeHostBridge's recorded calls and seeded data. */

import { describe, expect, it } from 'vitest';
import type { TurnEvent } from '../shapes';
import { createFakeHostBridge } from './fake-host-bridge';

describe('createFakeHostBridge', () => {
  it('records every ask', async () => {
    const bridge = createFakeHostBridge();

    await bridge.ask({ petId: 'scout', text: 'hello' });
    await bridge.ask({ petId: 'scout', text: 'again' });

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
