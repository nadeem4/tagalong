/** Tests for Home's minimum width. */

import { describe, expect, it } from 'vitest';
import { HOME_MIN_WIDTH } from './home';

describe('Home window', () => {
  it('fits a small laptop screen and still shows the overview two cards across', () => {
    // The 232px nav, the page's 32px padding each side, two 260px cards and their 16px gap.
    const twoCards = 232 + 2 * 32 + 2 * 260 + 16;
    expect(HOME_MIN_WIDTH).toBeLessThanOrEqual(900);
    expect(HOME_MIN_WIDTH).toBeGreaterThanOrEqual(twoCards);
  });
});
