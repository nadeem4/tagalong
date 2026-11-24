/**
 * What the Devices page reads of the brain's paired devices (devices_list): machines and
 * browsers apart from AI tools, revoked ones left out. Contains parseDevices, DeviceRow and
 * DevicesState. No token or hash ever reaches it; the brain does not send one.
 */
import { z } from 'zod';

const Wire = z.object({
  devices: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.string(),
      paired_at: z.string(),
      last_seen: z.string().nullable(),
      revoked_at: z.string().nullable(),
    }),
  ),
});

export interface DeviceRow {
  id: string;
  name: string;
  /** `desktop`, `browser` or `node` for a machine; `mcp_client` is an AI tool. */
  kind: string;
  /** ISO, UTC. */
  pairedAt: string;
  lastSeen: string | null;
}

export interface DevicesState {
  devices: DeviceRow[];
  aiTools: DeviceRow[];
}

export function parseDevices(json: unknown): DevicesState {
  const live = Wire.parse(json)
    .devices.filter((d) => d.revoked_at === null)
    .map((d): DeviceRow => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      pairedAt: d.paired_at,
      lastSeen: d.last_seen,
    }));
  return {
    devices: live.filter((d) => d.kind !== 'mcp_client'),
    aiTools: live.filter((d) => d.kind === 'mcp_client'),
  };
}
