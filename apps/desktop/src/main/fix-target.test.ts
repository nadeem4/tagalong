import { describe, expect, it } from 'vitest';
import { fixPage } from './fix-target';

describe('fixPage', () => {
  it('opens plain Settings when no target is named', () => {
    expect(fixPage(undefined)).toBe('settings');
  });

  it.each([
    ['brain', 'settings#brain'],
    ['voice', 'settings#voice'],
    ['browser', 'settings#browser'],
    ['privacy', 'settings#privacy'],
    ['experts', 'experts'],
    ['connections', 'connections'],
  ])('sends %s to %s', (target, page) => {
    expect(fixPage(target)).toBe(page);
  });

  it('refuses anything not on the list, rather than open a page a window named', () => {
    for (const target of ['advanced', 'settings#brain', '../x', 42, null, {}]) {
      expect(() => fixPage(target)).toThrow('Tagalong has no fix');
    }
  });
});
