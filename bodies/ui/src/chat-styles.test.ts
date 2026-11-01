/** Tests for CHAT_CSS: the padding rule on every bordered or filled rule that holds text. */
import { describe, expect, it } from 'vitest';
import { CHAT_CSS } from './chat-styles';
import { minPadding, ruleOf } from './test-support/css-rules';

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

describe('CHAT_CSS chat window', () => {
  it('has a 52px header', () => {
    expect(ruleOf(CHAT_CSS, '.bubble-head')).toContain('height: 52px');
  });

  it('keeps turns 24px apart and 12px inside', () => {
    expect(ruleOf(CHAT_CSS, '.bubble-log')).toContain('gap: 24px');
    expect(ruleOf(CHAT_CSS, '.bubble-exchange')).toContain('gap: 12px');
  });

  it('puts a user message on a tile with at least 12px inside', () => {
    expect(minPadding(CHAT_CSS, '.bubble-mine')).toBeGreaterThanOrEqual(12);
  });

  it('shows a pill that is on with a gold dot and a muted gold edge', () => {
    expect(ruleOf(CHAT_CSS, ".bubble-toggle[aria-checked='true']")).toContain(
      'border-color: #6B5A2A',
    );
    expect(ruleOf(CHAT_CSS, ".bubble-toggle[aria-checked='true']::before")).toContain('#F2C14E');
  });

  it('keeps the context chips at least 8px from their edge', () => {
    expect(minPadding(CHAT_CSS, '.bubble-chip')).toBeGreaterThanOrEqual(8);
  });
});
