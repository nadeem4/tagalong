/** Tests for CHAT_CSS: the padding rule on every bordered or filled rule that holds text. */
import { describe, expect, it } from 'vitest';
import { CHAT_CSS } from './chat-styles';
import { minPadding } from './test-support/css-rules';

describe('minPadding', () => {
  it('reads shorthand and ignores the vertical sides of a fixed-height rule', () => {
    expect(minPadding('.a { padding: 12px 8px; }', '.a')).toBe(8);
    expect(minPadding('.a { height: 28px; padding: 0 10px; }', '.a')).toBe(10);
    expect(minPadding('.a { padding: 4px 12px; }', '.a')).toBe(4);
  });
});

describe('CHAT_CSS padding', () => {
  it('keeps the quiet line at least 8px from its edge', () => {
    expect(minPadding(CHAT_CSS, '.bubble--line')).toBeGreaterThanOrEqual(8);
  });
});
