/** Tests for the pairing words: a brain's name from its address, which addresses are this PC, the host of a pairing link. */

import { describe, expect, it } from 'vitest';
import { brainNameOf, isLocalAddr, linkHost } from './pair-text';

const FP = 'ab'.repeat(32);

describe('brainNameOf', () => {
  it('is the host, without scheme or port', () => {
    expect(brainNameOf('192.168.1.20:47323')).toBe('192.168.1.20');
    expect(brainNameOf('wss://mini-pc.local:47323')).toBe('mini-pc.local');
  });
});

describe('isLocalAddr', () => {
  it.each(['127.0.0.1:47321', 'localhost:47321', '[::1]:47321', 'ws://127.0.0.1:47321'])(
    'treats %s as this computer',
    (addr) => expect(isLocalAddr(addr)).toBe(true),
  );

  it.each(['192.168.1.20:47323', '127.0.0.2:47323', 'mini-pc.local:47323'])(
    'treats %s as another computer',
    (addr) => expect(isLocalAddr(addr)).toBe(false),
  );
});

describe('linkHost', () => {
  it('is the host of a pairing link', () => {
    expect(linkHost(`tagalong://pair?addr=192.168.1.20:47323&fp=${FP}&code=xyz`)).toBe(
      '192.168.1.20',
    );
  });

  it('is null for text that is not a pairing link', () => {
    expect(linkHost('hello')).toBeNull();
    expect(linkHost('tagalong://pair?addr=192.168.1.20:47323')).toBeNull();
  });
});
