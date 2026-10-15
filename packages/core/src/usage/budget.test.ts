import { describe, expect, it } from 'vitest';
import { budgetSpent } from './budget';

describe('budgetSpent', () => {
  it('is never spent with no cap', () => {
    expect(budgetSpent({ todayUsd: () => 99 }, () => null)()).toBe(false);
  });

  it('is spent once today’s priced dollars reach the cap', () => {
    let spent = 0.99;
    const gate = budgetSpent({ todayUsd: () => spent }, () => 1);
    expect(gate()).toBe(false);
    spent = 1;
    expect(gate()).toBe(true);
  });

  it('reads the cap each time, so saving it in Settings applies at once', () => {
    let cap: number | null = 5;
    const gate = budgetSpent({ todayUsd: () => 2 }, () => cap);
    expect(gate()).toBe(false);
    cap = 1;
    expect(gate()).toBe(true);
  });

  it('lets work through when the spend cannot be read', () => {
    const gate = budgetSpent(
      {
        todayUsd: () => {
          throw new Error('database closed');
        },
      },
      () => 1,
    );
    expect(gate()).toBe(false);
  });
});
