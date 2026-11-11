/**
 * Tests for CHAT_CSS: the padding rule on every bordered or filled rule that holds text.
 * Reads the rules as text, so it needs no browser. Uses the helpers in test-support/css-rules.
 */
import { describe, expect, it } from 'vitest';
import { CARD_CSS } from './card-styles';
import { CHAT_CSS } from './chat-styles';
import { minPadding, ruleOf } from './test-support/css-rules';
import { themeTokens as t } from './theme/tokens';

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
  it('draws your message on the mine token with the mockup radius', () => {
    const rule = ruleOf(CHAT_CSS, '.bubble-mine');
    expect(rule).toContain(t.color.mine);
    expect(rule).toContain('border-radius: 14px 14px 4px 14px');
  });

  it("sets Scout's reply behind its mark, capped at 60ch", () => {
    expect(ruleOf(CHAT_CSS, '.bubble-scout')).toContain('max-width: 60ch');
    expect(ruleOf(CHAT_CSS, '.bubble-scout')).toContain('grid-template-columns: 24px 1fr');
  });

  it('folds a long answer to its gist behind a fade', () => {
    expect(ruleOf(CHAT_CSS, '.answer-gist')).toContain('max-height: 126px');
    expect(CHAT_CSS).toContain('.answer-gist::after');
  });
  it('has a 56px header', () => {
    expect(ruleOf(CHAT_CSS, '.bubble-head')).toContain('height: 56px');
  });

  it('keeps turns 24px apart and 12px inside', () => {
    expect(ruleOf(CHAT_CSS, '.bubble-log')).toContain('gap: 24px');
    expect(ruleOf(CHAT_CSS, '.bubble-exchange')).toContain('gap: 12px');
  });

  it('puts a user message on a tile with the mockup padding of 10px 14px', () => {
    expect(minPadding(CHAT_CSS, '.bubble-mine')).toBeGreaterThanOrEqual(10);
  });

  it('shows an icon toggle that is on with a gold fill and a muted gold edge', () => {
    expect(ruleOf(CHAT_CSS, ".bubble-tg[aria-pressed='true']")).toContain(
      'rgba(242, 193, 78, 0.35)',
    );
  });

  it('keeps the context chips at least 8px from their edge', () => {
    expect(minPadding(CHAT_CSS, '.bubble-chip')).toBeGreaterThanOrEqual(8);
  });

  it('puts the chat approval card on the card surface with 16px inside', () => {
    expect(minPadding(CHAT_CSS, '.bubble--chat .card')).toBeGreaterThanOrEqual(16);
    expect(ruleOf(CHAT_CSS, '.bubble--chat .card')).toContain('border: 1px solid');
  });

  it('keeps the Stop button padded and the cursor gold', () => {
    expect(minPadding(CHAT_CSS, '.bubble-stop')).toBeGreaterThanOrEqual(8);
    expect(CHAT_CSS).toContain('.bubble-streaming');
    expect(CHAT_CSS).toContain('::after');
  });

  it('dims the field while a turn runs', () => {
    expect(ruleOf(CHAT_CSS, ".bubble-field textarea[aria-busy='true']")).toContain('opacity');
  });

  it('rings the composer in sky and keeps 8px inside it', () => {
    expect(ruleOf(CHAT_CSS, '.bubble-field:focus-within')).toContain('border-color');
    expect(minPadding(CHAT_CSS, '.bubble-field')).toBeGreaterThanOrEqual(8);
  });
});

describe('CARD_CSS ask card', () => {
  it('right-aligns its actions and shows the Always asks chip as a small pill', () => {
    expect(ruleOf(CARD_CSS, '.card-actions')).toContain('justify-content: flex-end');
    expect(ruleOf(CARD_CSS, '.card-chip')).toContain('border-radius: 999px');
  });

  it('draws a choice as a radio row, the recommended one edged in gold', () => {
    expect(ruleOf(CARD_CSS, '.bubble-radio')).toContain('border-radius: 50%');
    expect(ruleOf(CARD_CSS, '.bubble-choices .bubble-choice.bubble-primary')).toContain(
      t.color.gold,
    );
  });
});

describe('CARD_CSS recommended tag', () => {
  it('shows the Recommended tag at full strength', () => {
    expect(ruleOf(CARD_CSS, '.bubble-tag')).not.toContain('opacity');
  });
});
