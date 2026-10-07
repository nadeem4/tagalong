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
          notes: 'a calm explainer',
          model: 'claude-opus-5',
          providerId: 'anthropic',
          roleId: 'generalist',
          roleVersion: 1,
          toolGrants: {},
          replyStyle: 'text',
        },
      ],
    });

    await expect(bridge.listPets()).resolves.toHaveLength(1);
    await bridge.interrupt('t1');
    expect(bridge.interrupts).toEqual(['t1']);
  });

  it('lists the roles it was seeded with, and none by default', async () => {
    const writer = {
      id: 'writer',
      name: 'Writer',
      version: 1,
      summary: 'Drafts and rewrites text.',
      goodAt: ['drafts'],
      notFor: ['code'],
      tools: ['remember'],
      model: { tier: 'balanced' as const, needsVision: false },
      instructions: 'You are a writer.',
    };
    await expect(createFakeHostBridge().listRoles()).resolves.toEqual([]);
    await expect(createFakeHostBridge({ roles: [writer] }).listRoles()).resolves.toEqual([writer]);
  });

  it('recommends what the test asks for, and nothing by default', async () => {
    await expect(createFakeHostBridge().recommendModel('writer', 'fake')).resolves.toEqual({});
    const bridge = createFakeHostBridge({
      recommend: (roleId, providerId) => ({ model: `${roleId}@${providerId}` }),
    });
    await expect(bridge.recommendModel('writer', 'nebius')).resolves.toEqual({
      model: 'writer@nebius',
    });
  });
});
