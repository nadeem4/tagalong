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
    const parts = splitReply(text, 100, 1000);
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

  test('test_reply_past_four_messages_is_cut_with_the_note', () => {
    const text = Array.from({ length: 5 }, (_, i) => String(i).repeat(40)).join('\n\n');
    const parts = splitReply(text, 60, 4);
    expect(parts).toHaveLength(4);
    expect(parts.slice(0, 3)).toEqual(['0'.repeat(40), '1'.repeat(40), '2'.repeat(40)]);
    // 60 minus the 27-character note leaves room for 33 characters of the fourth part.
    expect(parts[3]).toBe(`${'3'.repeat(33)}\n(cut: ask me for the rest)`);
  });

  test('test_the_cut_part_is_still_within_the_limit', () => {
    const parts = splitReply('x'.repeat(500), 50, 4);
    expect(parts).toHaveLength(4);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(50);
    expect(parts[3]?.endsWith('\n(cut: ask me for the rest)')).toBe(true);
    expect(parts[3]?.startsWith('x')).toBe(true);
  });

  test('test_exactly_four_parts_has_no_note', () => {
    const parts = splitReply('x'.repeat(200), 50, 4);
    expect(parts).toEqual(['x'.repeat(50), 'x'.repeat(50), 'x'.repeat(50), 'x'.repeat(50)]);
  });

  test('test_the_cut_note_never_splits_a_surrogate_pair', () => {
    // Room for 59 characters ends between the two halves of the emoji at 58-59.
    const parts = splitReply(`${'x'.repeat(58)}\u{1F600}${'y'.repeat(400)}`, 86, 1);
    const last = parts[0] ?? '';
    expect(last.length).toBeLessThanOrEqual(86);
    expect(last).not.toMatch(/[\ud800-\udbff]\n/);
  });
});
