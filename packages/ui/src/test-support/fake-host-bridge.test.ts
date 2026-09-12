import { describe, expect, it } from 'vitest';
import type { TurnEvent } from '../host-bridge';
import { createFakeHostBridge } from './fake-host-bridge';

describe('createFakeHostBridge', () => {
  it('records every ask and answers with a fresh turn id', async () => {
    const bridge = createFakeHostBridge();

    const first = await bridge.ask({ petId: 'sage', text: 'hello' });
    const second = await bridge.ask({ petId: 'sage', text: 'again' });

    expect(first.turnId).not.toBe(second.turnId);
    expect(bridge.asks).toEqual([
      { petId: 'sage', text: 'hello' },
      { petId: 'sage', text: 'again' },
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
      pets: [
        {
          id: 'sage',
          name: 'Sage',
          avatar: '🦊',
          persona: 'a calm explainer',
          model: 'claude-opus-5',
          providerId: 'anthropic',
          toolAllowlist: [],
          replyStyle: 'text',
        },
      ],
    });

    await expect(bridge.listPets()).resolves.toHaveLength(1);
    await bridge.interrupt('t1');
    expect(bridge.interrupts).toEqual(['t1']);
  });
});
