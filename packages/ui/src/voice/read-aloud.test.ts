import { describe, expect, it } from 'vitest';
import { wantsReadAloud } from './read-aloud';

describe('wantsReadAloud', () => {
  it.each([
    'read this to me',
    'Scout, read this to me',
    'read it aloud',
    'Say that out loud',
    'can you READ the selection out loud?',
  ])('matches "%s"', (text) => {
    expect(wantsReadAloud(text)).toBe(true);
  });

  it.each(['I read it yesterday', 'read the docs and fix it', 'what does this say'])(
    'does not match "%s"',
    (text) => {
      expect(wantsReadAloud(text)).toBe(false);
    },
  );

  it('does not match an empty or blank line', () => {
    expect(wantsReadAloud('')).toBe(false);
    expect(wantsReadAloud('   ')).toBe(false);
  });

  it('does not match "aloud" or "to me" without read or say', () => {
    expect(wantsReadAloud('explain this to me')).toBe(false);
    expect(wantsReadAloud('laugh out loud')).toBe(false);
  });

  it('does not match words that only contain read or say', () => {
    expect(wantsReadAloud('is the thread ready to me?')).toBe(false);
    expect(wantsReadAloud('the essay out loud')).toBe(false);
  });
});
