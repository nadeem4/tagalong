/**
 * The page reader is injected into the user's tab on every read, so what it imports ships
 * into that page each time. Zod alone would more than double it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the injected page reader', () => {
  it('takes its budgets from a local limits module, which imports nothing', () => {
    const limits = readFileSync(new URL('./limits.ts', import.meta.url), 'utf8');
    expect(limits).not.toMatch(/^\s*import\s/m);
  });

  it('imports ./limits, never the protocol or zod', () => {
    const reader = readFileSync(new URL('./read-page.ts', import.meta.url), 'utf8');
    expect(reader).toContain("from './limits'");
    expect(reader).not.toMatch(/from '@tagalong\/protocol/);
    expect(reader).not.toMatch(/from 'zod'/);
  });
});
