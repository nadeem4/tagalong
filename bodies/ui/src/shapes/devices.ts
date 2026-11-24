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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Nov", in the viewer's time zone. */
export const dayWords = (iso: string): string => {
  const at = new Date(iso);
  return `${at.getDate()} ${MONTHS[at.getMonth()]}`;
};

/** "today, 18:02", "yesterday, 18:02" or "14 Nov": when a device was last seen. */
export function seenWords(iso: string, now: number = Date.now()): string {
  const at = new Date(iso);
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  if (at.getTime() >= midnight) return `today, ${clock}`;
  if (at.getTime() >= midnight - 86_400_000) return `yesterday, ${clock}`;
  return dayWords(iso);
}

/** What `tailscale ip -4` found on this PC: not installed, installed but signed out, or its address. */
export interface TailscaleState {
  installed: boolean;
  ip: string | null;
}

/** The host part of a brain address when it is a Tailscale one (100.64.0.0/10 or `*.ts.net`), else null. */
export function tailnetHost(addr: string): string | null {
  const host = addr.replace(/:\d+$/, '');
  return /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(host) || host.endsWith('.ts.net')
    ? host
    : null;
}
