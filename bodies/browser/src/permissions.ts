/**
 * What the body may ask the user for (Chrome optional permissions and per-site access) and the
 * broker that asks. A tool calls `ensure`; the broker opens one small window per need and
 * turns a "no", a closed window or silence into a plain `tool_failed` sentence.
 */
import { ErrorCode, RpcError } from '@tagalong/contract';

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

export interface PermissionsApi {
  contains(need: Need): Promise<boolean>;
  getAll(): Promise<{ permissions: string[]; origins: string[] }>;
  remove(need: Need): Promise<boolean>;
}

export type Answer = 'granted' | 'declined' | 'closed';

export interface PermissionPrompt {
  ask(need: Need, reason: string): Promise<Answer>;
}

/** A tool waits this long for the person to answer before giving up. */
export const PERMISSION_WAIT_MS = 25_000;

/** Origin of a local file page, since `new URL('file:///x').origin` is the string "null". */
export const FILE_ORIGIN = 'file://';

/** The Chrome match pattern that covers a site origin. */
export function originPattern(origin: string): string {
  return origin === FILE_ORIGIN ? 'file:///*' : `${origin}/*`;
}

const ABILITIES: Record<OptionalPermission, string> = {
  tabs: 'see open tabs',
  history: 'search browsing history',
  bookmarks: 'use bookmarks',
  downloads: 'see downloads',
  sessions: 'see recently closed tabs',
  readingList: 'use the reading list',
  tabGroups: 'use tab groups',
  contextMenus: 'add right-click menu items',
};

/** The plain sentence a tool fails with when the person did not allow it. */
export function denial(need: Need): string {
  if (need.kind === 'permission') {
    return `the person has not allowed Scout to ${ABILITIES[need.name]}`;
  }
  const where = need.origin === FILE_ORIGIN ? 'local files' : new URL(need.origin).host;
  return `the person has not allowed reading ${where}`;
}

export class PermissionBroker {
  // One open window per need; calls that arrive while it is open wait on the same answer.
  private readonly open = new Map<string, Promise<Answer>>();

  constructor(
    private readonly api: PermissionsApi,
    private readonly prompt: PermissionPrompt,
    private readonly waitMs: number = PERMISSION_WAIT_MS,
  ) {}

  async ensure(need: Need, reason: string): Promise<void> {
    if (await this.api.contains(need)) return;
    const key = JSON.stringify(need);
    let asking = this.open.get(key);
    if (asking === undefined) {
      asking = this.prompt.ask(need, reason).finally(() => this.open.delete(key));
      this.open.set(key, asking);
    }
    const answer = await this.withinWait(asking);
    // "closed" is rechecked too: the window closes itself right after a real grant, so the close
    // can be seen before the answer. Only a plain "no" or silence skips the check.
    const maybeHeld = answer === 'granted' || answer === 'closed';
    if (!maybeHeld || !(await this.api.contains(need))) {
      throw new RpcError(ErrorCode.tool_failed, denial(need));
    }
  }

  /** The race is per call, not per window: a late caller still gets its own full wait. */
  private withinWait(asking: Promise<Answer>): Promise<Answer | 'silent'> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const silence = new Promise<'silent'>((resolve) => {
      timer = setTimeout(() => resolve('silent'), this.waitMs);
    });
    return Promise.race([asking, silence]).finally(() => clearTimeout(timer));
  }
}
