/** Tests for the pair link parser and the order a body tries brain addresses in. */
import { describe, expect, it } from 'vitest';
import { dialOrder, parsePairLink } from './pair-link.js';

const fp = 'ab'.repeat(32);
const link = (q: string) => `tagalong://pair?${q}`;

describe('parsePairLink', () => {
  it('parses a good link and trims whitespace', () => {
    expect(parsePairLink(`  ${link(`addr=10.0.0.5:47323&fp=${fp}&code=s3cret`)}\n`)).toEqual({
      addr: '10.0.0.5:47323',
      fp,
      code: 's3cret',
    });
  });

  it.each([
    ['a wrong scheme', `https://pair?addr=10.0.0.5:47323&fp=${fp}&code=x`],
    ['a missing fp', link('addr=10.0.0.5:47323&code=x')],
    ['a short fp', link('addr=10.0.0.5:47323&fp=abcd&code=x')],
    ['an addr with a path', link(`addr=10.0.0.5:47323/x&fp=${fp}&code=x`)],
    ['an addr without a port', link(`addr=10.0.0.5&fp=${fp}&code=x`)],
    ['a missing code', link(`addr=10.0.0.5:47323&fp=${fp}`)],
  ])('rejects %s', (_, text) => {
    expect(parsePairLink(text)).toBeNull();
  });
});

describe('dialOrder', () => {
  it('tries last good, saved, then found on the network, without duplicates', () => {
    expect(dialOrder({ addrs: ['a:1', 'b:2'], lastGood: 'b:2' }, ['c:3', 'a:1'])).toEqual([
      'b:2',
      'a:1',
      'c:3',
    ]);
  });
});
