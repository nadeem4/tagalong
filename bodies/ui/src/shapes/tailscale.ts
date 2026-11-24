/**
 * What the Devices page knows of Tailscale: what `tailscale ip -4` found on this PC, and whether
 * a brain address is a tailnet one. Contains TailscaleState and tailnetHost.
 */

/** Not installed, installed but signed out (`ip` null), or its address. */
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
