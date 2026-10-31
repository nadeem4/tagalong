/**
 * The HostBridge a window hands to @tagalong/ui: the preload's calls plus the three the preload
 * cannot make itself (the health check, Fix it, Open logs folder), which need renderer code.
 * Contains fullBridge.
 */
import type { HostBridge } from '@tagalong/ui';
import type { FixTarget } from '@tagalong/ui/shapes';
import { gatherHealth, HEALTH_TEST_BUDGET_MS } from './health-facts';
import { listMicrophones } from './mic';

/**
 * The preload's bridge, plus the health check ("Scout, what's wrong?"), read from calls Home
 * and Settings already make, its Fix it, which opens the right place, and Open logs folder.
 */
export function fullBridge(): HostBridge {
  const bridge = window.tagalong;
  const host = window.tagalongHost;
  return {
    ...bridge,
    checkHealth: () =>
      gatherHealth({
        getHostView: () => host.getHostView(),
        listConnections: () => bridge.listConnections(),
        listMicrophones: () => listMicrophones(),
        voiceModels: () => host.voiceModels(),
        testBudgetMs: HEALTH_TEST_BUDGET_MS,
      }),
    openFix: (target: FixTarget) => host.openSettings(target),
    openLogs: () => host.openLogsFolder(),
  };
}
