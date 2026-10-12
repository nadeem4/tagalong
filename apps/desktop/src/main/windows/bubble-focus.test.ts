import { describe, expect, it } from 'vitest';
import { hidesOnBlur } from './bubble-focus';

describe('hidesOnBlur', () => {
  it('hides the bubble when focus goes to another app', () => {
    expect(hidesOnBlur({ streaming: false, focusWentToPet: false })).toBe(true);
  });

  it('keeps it while an answer streams in', () => {
    expect(hidesOnBlur({ streaming: true, focusWentToPet: false })).toBe(false);
  });

  it('keeps it when the focus went to the pet: a click or a drag on the pet that speaks it', () => {
    expect(hidesOnBlur({ streaming: false, focusWentToPet: true })).toBe(false);
  });
});
