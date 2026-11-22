/** Tests for discoverBrains: what the home-network browse turns into a list of brains. */
import { describe, expect, it } from 'vitest';
import { discoverBrains } from './discover';
import type { Announcement, BrowseFn } from './discover';

const brain = (name: string, ip: string, port = 47323): Announcement => ({
  name,
  type: '_tagalong._tcp',
  port,
  addresses: [ip],
});

const browsing =
  (...found: Announcement[]): BrowseFn =>
  (onUp) => {
    found.forEach(onUp);
    return () => undefined;
  };

describe('discoverBrains', () => {
  it('lists each brain by name and address, merging the same address and skipping other services', async () => {
    const found = await discoverBrains({
      browse: browsing(
        brain('Desk', '192.168.1.5'),
        brain('Desk (2)', '192.168.1.5'),
        brain('Study', '192.168.1.9'),
        { ...brain('Printer', '192.168.1.7'), type: '_ipp._tcp' },
        { ...brain('NoPort', '192.168.1.8'), port: 0 },
        { ...brain('NoAddr', '192.168.1.8'), addresses: [] },
      ),
      timeoutMs: 5,
    });
    expect(found).toEqual([
      { name: 'Desk', addr: '192.168.1.5:47323' },
      { name: 'Study', addr: '192.168.1.9:47323' },
    ]);
  });

  it('resolves after the timeout with what it has and stops browsing', async () => {
    let stopped = false;
    const browse: BrowseFn = (onUp) => {
      onUp(brain('Desk', '192.168.1.5'));
      return () => void (stopped = true);
    };
    const found = await discoverBrains({ browse, timeoutMs: 5 });
    expect(found).toHaveLength(1);
    expect(stopped).toBe(true);
  });
});
