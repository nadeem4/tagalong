/** Tests for startingGate: a stale launch's end never clears a newer launch's Starting. */
import { describe, expect, it } from 'vitest';
import { startingGate } from './starting-gate';

describe('startingGate', () => {
  it('passes the current launch through', () => {
    const seen: boolean[] = [];
    const gate = startingGate((on) => seen.push(on));
    const a = gate.next();
    a(true);
    a(false);
    expect(seen).toEqual([true, false]);
  });

  it('ignores a stale launch ending after a newer one started', () => {
    const seen: boolean[] = [];
    const gate = startingGate((on) => seen.push(on));
    const old = gate.next();
    old(true);
    const fresh = gate.next();
    fresh(true);
    old(false);
    expect(seen).toEqual([true, true]);
    fresh(false);
    expect(seen).toEqual([true, true, false]);
  });
});
