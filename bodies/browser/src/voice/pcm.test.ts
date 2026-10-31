/**
 * Tests for the float to int16 conversion the offscreen page does on each mic frame.
 */
import { describe, expect, it } from 'vitest';
import { toPcm16 } from './pcm';

describe('toPcm16', () => {
  it('scales_rounds_and_keeps_the_length', () => {
    const out = toPcm16(new Float32Array([0, 0.5, -0.5]));
    expect(Array.from(out)).toEqual([0, 16384, -16384]);
  });

  it('clamps_anything_outside_minus_one_to_one', () => {
    const out = toPcm16(new Float32Array([2, -2, 1, -1]));
    expect(Array.from(out)).toEqual([32767, -32768, 32767, -32768]);
  });
});
