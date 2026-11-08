/** Test for the entry's start-up check: a bad setup stops with a plain message, not a trace. */
import { expect, test } from 'vitest';
import { main } from './index';

test('test_missing_values_exit_with_a_plain_message_and_status_1', () => {
  const out: string[] = [];
  const codes: number[] = [];
  const started = main(
    { TAGALONG_WHATSAPP_ACCESS_TOKEN: 'tok-secret' },
    (code) => codes.push(code),
    (line) => out.push(line),
  );
  expect(started).toBeNull();
  expect(codes).toEqual([1]);
  expect(out.join('\n')).toContain('TAGALONG_WHATSAPP_APP_SECRET');
  expect(out.join('\n')).not.toContain('tok-secret');
});
