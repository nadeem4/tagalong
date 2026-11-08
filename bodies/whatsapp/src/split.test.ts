/** Tests for cutting a long reply into messages WhatsApp will accept. */
import { describe, expect, test } from 'vitest';
import { splitReply } from './split';

describe('splitReply', () => {
  test('test_short_text_is_one_part', () => {
    expect(splitReply('hello there')).toEqual(['hello there']);
  });

  test('test_split_prefers_paragraph_then_line_then_space', () => {
    const a = 'a'.repeat(6);
    const b = 'b'.repeat(6);
    expect(splitReply(`${a}\n\n${b}`, 10)).toEqual([a, b]);
    expect(splitReply(`${a}\n${b}`, 10)).toEqual([a, b]);
    expect(splitReply(`${a} ${b}`, 10)).toEqual([a, b]);
  });

  test('test_split_hard_breaks_text_with_no_break', () => {
    expect(splitReply('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
  });

  test('test_every_part_is_within_the_limit', () => {
    const text = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
    const parts = splitReply(text, 100);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(100);
      expect(p.length).toBeGreaterThan(0);
    }
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(text);
  });

  test('test_hard_cut_never_splits_a_surrogate_pair', () => {
    const text = `${'x'.repeat(9)}😀${'y'.repeat(5)}`;
    const parts = splitReply(text, 10);
    expect(parts.join('')).toBe(text);
    for (const p of parts) expect(p).not.toMatch(/[\ud800-\udbff]$/);
  });

  test('test_empty_is_no_parts', () => {
    expect(splitReply('')).toEqual([]);
    expect(splitReply('  \n ')).toEqual([]);
  });
});
