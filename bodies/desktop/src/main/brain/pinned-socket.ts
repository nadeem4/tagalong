/**
 * The desktop's socket to a brain on another machine: wss to the network listener, trusting
 * exactly one certificate, the one whose SHA-256 fingerprint the owner paired with. The brain's
 * certificate is self-signed, so names and chains mean nothing here; the pin is the identity.
 * A mismatch closes the socket before anything is sent; there is no plain ws fallback.
 */
import { createHash } from 'node:crypto';
import { connect } from 'node:tls';
import WebSocket from 'ws';
import type { BrainSocket } from '@tagalong/contract';

export interface PinnedSocket extends BrainSocket {
  /** True once the brain showed a certificate other than the pinned one. */
  mismatch(): boolean;
}

export function pinnedSocket(url: string, fingerprint: string): PinnedSocket {
  if (!url.startsWith('wss://')) throw new Error('a remote brain is reached over wss only');
  const pin = fingerprint.toLowerCase();
  let trusted = false;
  let mismatch = false;
  // Node skips checkServerIdentity once the self-signed chain fails, so the pin is checked when
  // the handshake finishes, before the http upgrade is written: no hello, and no token, is ever
  // sent to a brain that fails it.
  const ws = new WebSocket(url, {
    rejectUnauthorized: false,
    createConnection: (options, onConnect) => {
      const socket = connect(options, onConnect);
      socket.once('secureConnect', () => {
        const { raw } = socket.getPeerCertificate();
        trusted = raw !== undefined && createHash('sha256').update(raw).digest('hex') === pin;
        mismatch = !trusted;
        if (!trusted) socket.destroy();
      });
      return socket;
    },
  });
  // An error is always followed by close, which is where reconnecting starts.
  ws.on('error', () => undefined);
  return {
    mismatch: () => mismatch,
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onOpen: (f) => ws.on('open', () => trusted && f()),
    onMessage: (f) => ws.on('message', (data) => f(data.toString())),
    onClose: (f) => ws.on('close', () => f()),
  };
}
