/**
 * Gate for tab facts. Chrome fills tab.url and title whenever the extension has host access to
 * the site, so the `tabs` allow must be checked here, and private windows are never reported.
 */
import type { PermissionsApi } from './permissions';

export interface TabFact {
  title: string;
  url: string;
}

export function tabFactSender(
  permissions: Pick<PermissionsApi, 'contains'>,
  send: (fact: TabFact) => void,
): (tab: {
  title?: string | undefined;
  url?: string | undefined;
  incognito?: boolean | undefined;
}) => Promise<void> {
  return async (tab) => {
    if (tab.incognito) return;
    if (!(await permissions.contains({ kind: 'permission', name: 'tabs' }))) return;
    send({ title: tab.title ?? '', url: tab.url ?? '' });
  };
}
