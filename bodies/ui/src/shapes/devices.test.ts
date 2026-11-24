/** Tests for parseDevices: the brain's devices_list as the Devices page reads it. */
import { describe, expect, it } from 'vitest';
import { parseDevices, seenWords } from './devices';

const row = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  kind,
  personal: 0,
  paired_at: '2026-11-14T09:00:00Z',
  last_seen: null,
  revoked_at: null,
  ...extra,
});

describe('parseDevices', () => {
  it('splits machines and browsers from AI tools and drops the revoked', () => {
    const { devices, aiTools } = parseDevices({
      devices: [
        row('laptop', 'desktop', { last_seen: '2026-11-22T18:02:00Z' }),
        row('chrome', 'browser'),
        row('gone', 'desktop', { revoked_at: '2026-11-20T10:00:00Z' }),
        row('cursor', 'mcp_client'),
      ],
    });
    expect(devices.map((d) => d.id)).toEqual(['laptop', 'chrome']);
    expect(aiTools.map((d) => d.id)).toEqual(['cursor']);
    expect(devices[0]).toMatchObject({
      name: 'laptop',
      kind: 'desktop',
      lastSeen: '2026-11-22T18:02:00Z',
    });
    expect(devices[1]?.lastSeen).toBeNull();
  });
});

describe('seenWords', () => {
  const now = new Date(2026, 10, 23, 12, 0).getTime();
  const at = (day: number, hour: number, minute: number) =>
    new Date(2026, 10, day, hour, minute).toISOString();

  it('says today or yesterday with the time, and a date after that', () => {
    expect(seenWords(at(23, 9, 5), now)).toBe('today, 09:05');
    expect(seenWords(at(22, 18, 2), now)).toBe('yesterday, 18:02');
    expect(seenWords(at(14, 8, 0), now)).toBe('14 Nov');
  });
});
