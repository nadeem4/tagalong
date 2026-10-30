/**
 * The `tabs` tool: list the open tabs, read the page in one, or picture the one in front.
 * Reading asks for the tabs permission and then the site, in that order (sharing one wait), and
 * never wakes a sleeping tab or touches a
 * page Chrome keeps locked.
 */
import type { Part } from '@tagalong/contract';
import { MAX_PAGE_TEXT_CHARS } from '../content/limits';
import type { PageApi, PictureApi, TabInfo, TabsApi } from '../layer/api';
import { FILE_ORIGIN, PERMISSION_WAIT_MS, type Need } from '../permissions';
import { failed, invalid, type BrowserTool } from './registry';

/** Satisfied by the permission broker; a seam so this tool is testable alone. */
export interface Needs {
  /** `waitMs` caps how long to wait for the person; default is one full wait. */
  ensure(need: Need, reason: string, waitMs?: number): Promise<void>;
}

export interface TabsDeps {
  tabs: TabsApi;
  page: PageApi;
  picture: PictureApi;
  needs: Needs;
  bodyName: string;
}

const OPEN_SCHEMES = ['http:', 'https:', 'file:'];

/** What makes a page unreadable to an extension, or null when it is fine to read. */
function lockedReason(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'it has no address I can read';
  }
  if (u.hostname === 'chromewebstore.google.com') return 'it is the Chrome Web Store';
  if (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore')) {
    return 'it is the Chrome Web Store';
  }
  if (u.hostname === 'microsoftedge.microsoft.com' && u.pathname.startsWith('/addons')) {
    return 'it is the Edge add-ons store';
  }
  if (u.protocol === 'chrome-extension:') return 'it is a page of a browser extension';
  if (!OPEN_SCHEMES.includes(u.protocol)) return 'it is a page of the browser itself';
  return null;
}

/** The origin to ask about; a file: URL's own origin is the useless string "null". */
function siteOrigin(url: string): string {
  const u = new URL(url);
  return u.protocol === 'file:' ? FILE_ORIGIN : u.origin;
}

async function pick(tabs: TabsApi, tabId: unknown): Promise<TabInfo> {
  if (tabId === undefined) {
    const active = await tabs.activeInFocusedWindow();
    if (active === null) throw failed('There is no active tab to read.');
    return active;
  }
  if (typeof tabId !== 'number') throw invalid('tab_id must be a number');
  const found = await tabs.get(tabId);
  if (found === null) throw failed(`There is no tab with id ${tabId}.`);
  return found;
}

/** Refuses a sleeping or locked tab. */
function refuseUnreadable(tab: TabInfo): void {
  if (tab.discarded) {
    throw failed('That tab is asleep, and Scout will not wake it. Ask the user to open it first.');
  }
  const locked = lockedReason(tab.url);
  if (locked !== null) throw failed(`I cannot read that tab: ${locked}.`);
}

/**
 * Shared by every tool that reads a tab: asks for tabs, finds the tab, refuses a sleeping or
 * locked one, runs the tool's own check, then asks for the tab's site.
 */
export async function resolveReadableTab(
  deps: { tabs: TabsApi; needs: Needs },
  tabId: unknown,
  tabsReason: string,
  check?: (tab: TabInfo) => void,
): Promise<TabInfo> {
  // One deadline for both questions, so they never outlast the brain's own timeout.
  const deadline = Date.now() + PERMISSION_WAIT_MS;
  await deps.needs.ensure({ kind: 'permission', name: 'tabs' }, tabsReason, PERMISSION_WAIT_MS);
  const tab = await pick(deps.tabs, tabId);
  refuseUnreadable(tab);
  check?.(tab);
  await deps.needs.ensure(
    { kind: 'site', origin: siteOrigin(tab.url) },
    `read ${tab.title || tab.url}`,
    Math.max(0, deadline - Date.now()),
  );
  return tab;
}

export function tabsTool(deps: TabsDeps): BrowserTool {
  const { tabs, page, picture: pictureApi, needs, bodyName } = deps;

  async function list(): Promise<Part[]> {
    await needs.ensure({ kind: 'permission', name: 'tabs' }, 'see which tabs are open');
    const all = await tabs.list();
    const out = all.map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
      active: t.active,
      asleep: t.discarded,
    }));
    return [{ type: 'text', text: JSON.stringify({ tabs: out }) }];
  }

  async function picture(tabId: unknown): Promise<Part[]> {
    const allowed = await resolveReadableTab(deps, tabId, 'take a picture of a tab', (t) => {
      if (!t.active) {
        throw failed(
          'Only the tab in front can be pictured, and Scout will not switch tabs. Ask the user to open it first.',
        );
      }
    });
    const tab = allowed;
    try {
      const shot = await pictureApi.capture(tab.windowId);
      return [{ type: 'image', mime: shot.mime, data: shot.base64 }];
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw failed(`I could not take a picture of that tab: ${why}`);
    }
  }

  async function read(tabId: unknown): Promise<Part[]> {
    const tab = await resolveReadableTab(deps, tabId, 'read a tab');
    let reading;
    try {
      reading = await page.read(tab.id);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw failed(`I could not read that tab: ${why}`);
    }
    const lines = [`url: ${reading.url}`, `title: ${reading.title}`];
    if (reading.selection !== '') lines.push(`selection: ${reading.selection}`);
    let text = `${lines.join('\n')}\n\n${reading.text.slice(0, MAX_PAGE_TEXT_CHARS)}`;
    if (reading.truncated || reading.text.length > MAX_PAGE_TEXT_CHARS)
      text += '\n[truncated at 40,000 characters]';
    return [{ type: 'text', text }];
  }

  return {
    tool: {
      name: 'tabs',
      description:
        'See the browser tabs the user has open, or read one. Use action "list" to find a tab, ' +
        'and action "read" to get the page text and any selection; prefer "read". Use "picture" ' +
        'only when the layout matters and text is not enough; it shows only the tab in front. ' +
        `Leave tab_id out to use the tab the user is looking at. This is the ${bodyName} browser.`,
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'read', 'picture'] },
          tab_id: { type: 'number', description: 'A tab id from list. Default: the active tab.' },
        },
        required: ['action'],
      },
      effect: 'read',
    },
    async run(input) {
      if (input['action'] === 'list') return list();
      if (input['action'] === 'read') return read(input['tab_id']);
      if (input['action'] === 'picture') return picture(input['tab_id']);
      throw invalid('action must be "list", "read" or "picture"');
    },
  };
}
