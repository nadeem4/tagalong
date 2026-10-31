/** Tests for walkthroughSize: the tour window never asks for more than the work area holds. */

import { describe, expect, it } from 'vitest';
import { walkthroughSize } from './walkthrough-size';

describe('walkthroughSize', () => {
  it('keeps 1040x680 on a roomy screen', () => {
    expect(walkthroughSize({ x: 0, y: 0, width: 1920, height: 1040 })).toEqual({
      width: 1040,
      height: 680,
    });
  });

  it('shrinks to the work area on a small or highly scaled screen', () => {
    expect(walkthroughSize({ x: 0, y: 0, width: 682, height: 512 })).toEqual({
      width: 682,
      height: 512,
    });
  });
});
