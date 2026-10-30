/** Tests for the TurnEvent union: every event the desktop sends has a typed shape. */
import { describe, expect, it } from 'vitest';
import type { TurnEvent } from './turn-events';

const T = '00000000-0000-4000-8000-000000000001';

describe('TurnEvent', () => {
  it('has a shape for every event the desktop sends the panels', () => {
    const events = [
      { type: 'turn.started', turnId: T, petId: 'scout', conversationId: 'brain' },
      { type: 'turn.delta', turnId: T, text: 'hi' },
      { type: 'turn.toolRequest', turnId: T, approvalId: 'a', callId: 'a', tool: 't', input: {} },
      { type: 'turn.toolResult', turnId: T, callId: 'a', tool: 't', ok: true, summary: '' },
      { type: 'turn.completed', turnId: T, text: 'hi', stopReason: 'end' },
      { type: 'turn.error', turnId: T, code: 'brain_error', message: 'm' },
      { type: 'turn.warning', turnId: T, code: 'w', message: 'm' },
      {
        type: 'connector.confirm',
        approvalId: 'a',
        turnId: T,
        petId: 'scout',
        app: 'Scout',
        tool: 't',
        summary: 's',
      },
      { type: 'connector.dismiss', approvalId: 'a' },
      { type: 'pet.remark', remarkId: T, petId: 'scout', text: 'hello' },
      { type: 'connections.changed' },
    ] satisfies TurnEvent[];
    expect(new Set(events.map((e) => e.type)).size).toBe(11);
  });
});
