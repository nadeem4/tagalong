/**
 * Type-level pin: the method maps expose their literal method names, so bodies can
 * type a method argument without repeating the list.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { BodyToBrainMethod, BrainToBodyMethod } from './messages.js';

describe('method maps', () => {
  it('has literal body to brain method names', () => {
    expectTypeOf<BodyToBrainMethod>().toEqualTypeOf<
      'hello' | 'tools' | 'say' | 'event' | 'call' | 'answer' | 'cancel' | 'progress'
    >();
  });
  it('has literal brain to body method names', () => {
    expectTypeOf<BrainToBodyMethod>().toEqualTypeOf<
      'use' | 'cancel' | 'reply' | 'turn' | 'tool' | 'ask' | 'changed'
    >();
  });
});
