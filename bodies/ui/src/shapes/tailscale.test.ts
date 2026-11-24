/** Tests for tailnetHost: which brain addresses count as Tailscale ones. */
import { describe, expect, it } from 'vitest';
import { tailnetHost } from './tailscale';

describe('tailnetHost', () => {
  it('names the host of a 100.64.0.0/10 or ts.net address, and nothing else', () => {
    expect(tailnetHost('100.101.102.103:47321')).toBe('100.101.102.103');
    expect(tailnetHost('100.128.0.1:47321')).toBeNull();
    expect(tailnetHost('mini-pc.tail1234.ts.net:47321')).toBe('mini-pc.tail1234.ts.net');
    expect(tailnetHost('192.168.1.5:47321')).toBeNull();
  });
});
