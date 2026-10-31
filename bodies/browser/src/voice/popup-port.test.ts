/**
 * Tests that the worker ends the listen when the popup's port goes away, and ignores other ports.
 */
import { describe, expect, it, vi } from 'vitest';
import { POPUP_PORT, watchPopupPort } from './popup-port';

function fakePort(name: string) {
  let gone: () => void = () => undefined;
  return {
    port: { name, onDisconnect: { addListener: (l: () => void) => (gone = l) } },
    disconnect: () => gone(),
  };
}

describe('the popup port', () => {
  it('a_closed_popup_ends_the_listen', () => {
    const onGone = vi.fn();
    const { port, disconnect } = fakePort(POPUP_PORT);
    watchPopupPort(port, onGone);
    expect(onGone).not.toHaveBeenCalled();
    disconnect();
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it('other_ports_are_ignored', () => {
    const onGone = vi.fn();
    const { port, disconnect } = fakePort('something-else');
    watchPopupPort(port, onGone);
    disconnect();
    expect(onGone).not.toHaveBeenCalled();
  });
});
