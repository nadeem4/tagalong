/**
 * The popup keeps a port open while it is showing, so the worker learns it is gone even when the
 * popup crashes or closes without a chance to send a message. A gone popup ends the listen, so
 * the microphone never stays open for nobody.
 */

/** The name the popup gives its port. */
export const POPUP_PORT = 'popup';

export interface PortLike {
  name: string;
  onDisconnect: { addListener(listener: () => void): void };
}

export function watchPopupPort(port: PortLike, onGone: () => void): void {
  if (port.name !== POPUP_PORT) return;
  port.onDisconnect.addListener(onGone);
}
