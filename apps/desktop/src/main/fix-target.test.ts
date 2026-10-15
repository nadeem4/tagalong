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
    const odd = [
      'advanced',
      'settings#brain',
      'experts#x',
      'Brain',
      ' brain',
      '../x',
      'https://example.com',
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
      '',
      42,
      null,
      {},
      ['brain'],
      { toString: () => 'brain' },
    ];
    for (const target of odd) {
      expect(() => fixPage(target)).toThrow('Tagalong has no fix');
    }
  });
});
