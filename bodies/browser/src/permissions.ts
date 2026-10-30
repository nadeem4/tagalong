/**
 * What the body may ask the user for: Chrome optional permissions and per-site access.
 * Only the vocabulary lives here for now; the broker that asks arrives with the tools that need it.
 */
export const OPTIONAL_PERMISSIONS = [
  'tabs',
  'history',
  'bookmarks',
  'downloads',
  'sessions',
  'readingList',
  'tabGroups',
  'contextMenus',
] as const;

export type OptionalPermission = (typeof OPTIONAL_PERMISSIONS)[number];

/** One thing a tool needs the user's yes for before it can run. */
export type Need =
  { kind: 'permission'; name: OptionalPermission } | { kind: 'site'; origin: string };
