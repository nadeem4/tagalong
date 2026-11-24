/**
 * PairDialog wired to a host (the Home bridge or the tour's host): it makes the code, copies the
 * link and offers to turn on network access. Brain card, Devices and the tour all open it.
 * Contains HostPairDialog.
 */
import type { HostBridge } from '../host-bridge';
import { PairDialog } from './pair-dialog';
import { PAIR_CSS } from './pair-styles';

export function HostPairDialog({
  host,
  onClose,
}: {
  host: Pick<HostBridge, 'pairMake' | 'copyText' | 'installBrainService'>;
  onClose: () => void;
}) {
  return (
    <>
      <style>{PAIR_CSS}</style>
      <PairDialog
        make={host.pairMake}
        copyText={host.copyText}
        enableNetwork={async () => (await host.installBrainService()).ok}
        onClose={onClose}
      />
    </>
  );
}
