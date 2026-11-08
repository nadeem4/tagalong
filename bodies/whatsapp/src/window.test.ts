/** Tests for the 24-hour window in which WhatsApp allows free text. */
import { describe, expect, test } from 'vitest';
import { ReplyWindow } from './window';

const HOUR = 3_600_000;

describe('Window', () => {
  test('test_closed_until_the_first_message', () => {
    expect(new ReplyWindow(() => 0).isOpen()).toBe(false);
  });

  test('test_open_for_24_hours_then_closed', () => {
    let now = 1000;
    const w = new ReplyWindow(() => now);
    w.touch();
    now += 24 * HOUR - 1;
    expect(w.isOpen()).toBe(true);
    now += 1;
    expect(w.isOpen()).toBe(false);
  });

  test('test_a_new_message_reopens_it', () => {
    let now = 0;
    const w = new ReplyWindow(() => now);
    w.touch();
    now = 30 * HOUR;
    expect(w.isOpen()).toBe(false);
    w.touch();
    expect(w.isOpen()).toBe(true);
  });
});
