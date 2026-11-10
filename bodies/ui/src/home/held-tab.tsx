/**
 * The Held tab on the Tasks page: the mail-loops panel as it is (the switch, the held rows,
 * Forget, Stop and wipe). A thin wrapper so the page names its tabs in one place. Contains
 * HeldTab.
 */
import { LoopsPanel } from './loops-panel';

export function HeldTab() {
  return <LoopsPanel />;
}
