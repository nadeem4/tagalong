/** Tests for when the bubble hides on blur. */

import { describe, expect, it } from 'vitest';
import { hidesOnBlur } from './bubble-focus';

describe('hidesOnBlur', () => {
  it('hides the bubble when focus goes to another app', () => {
    expect(hidesOnBlur({ streaming: false, focusWentToPet: false, focusedAgain: false })).toBe(
      true,
    );
  });

  it('keeps it while an answer streams in', () => {
    expect(hidesOnBlur({ streaming: true, focusWentToPet: false, focusedAgain: false })).toBe(
      false,
    );
  });

  it('keeps it when the focus went to the pet: a click or a drag on the pet that speaks it', () => {
    expect(hidesOnBlur({ streaming: false, focusWentToPet: true, focusedAgain: false })).toBe(
      false,
    );
  });

  it('keeps it when it was opened again and has the focus back by the time the blur is judged', () => {
    expect(hidesOnBlur({ streaming: false, focusWentToPet: false, focusedAgain: true })).toBe(
      false,
    );
  });
});
