/**
 * The `tab_actions` tool: open, close, switch, group, reopen, bookmark or save a page for later.
 * It changes the browser but only in ways the person can see and undo, so it carries no confirm;
 * each action asks only for the permission it needs, and an address to open must be http or https.
 */
import type { Part } from '@tagalong/contract';
import type { ActionsApi, TabsApi } from '../layer/api';
import { PERMISSION_WAIT_MS, type OptionalPermission } from '../permissions';
import { failed, invalid, type BrowserTool } from './registry';
import type { Needs } from './tabs';

export interface TabActionsDeps {
  actions: ActionsApi;
  tabs: TabsApi;
  needs: Needs;
  bodyName: string;
}

const text = (line: string): Part[] => [{ type: 'text', text: line }];

function tabIdOf(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) throw invalid('tab_id must be a number');
  return raw;
}

/** Only web addresses; javascript:, file:, chrome: and the like never open from here. */
function webAddress(raw: unknown): string {
  if (typeof raw !== 'string') throw invalid('url must be text');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw invalid('url must be a full address; only http and https addresses are allowed');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw invalid('only http and https addresses are allowed');
  }
  return raw;
}

/** An API call that rejects becomes a plain tool failure the model can read. */
async function attempt<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw failed(`I could not ${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function tabActionsTool(deps: TabActionsDeps): BrowserTool {
  const { actions, tabs, needs, bodyName } = deps;
  const need = (name: OptionalPermission, reason: string, waitMs?: number): Promise<void> =>
    needs.ensure({ kind: 'permission', name }, reason, waitMs);

  async function open(input: Record<string, unknown>): Promise<Part[]> {
    if (input['url'] !== undefined) {
      const url = webAddress(input['url']);
      const tab = await attempt('open that address', () => actions.open(url));
      return text(`Opened ${url} in a new tab (id ${tab.id}).`);
    }
    const query = input['search'];
    if (typeof query !== 'string' || query.trim() === '') {
      throw invalid('open needs a url or a search');
    }
    await need('search', `search the web for "${query}"`);
    const tab = await attempt('search', () => actions.search(query));
    return text(`Searched for "${query}" in a new tab (id ${tab.id}).`);
  }

  async function group(input: Record<string, unknown>): Promise<Part[]> {
    const ids = input['tab_ids'];
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((n) => Number.isInteger(n))) {
      throw invalid('group needs tab_ids, a list of tab ids');
    }
    const title = typeof input['title'] === 'string' ? input['title'] : undefined;
    await need('tabGroups', 'group tabs');
    await attempt('group those tabs', () => actions.group(ids as number[], title));
    return text(`Grouped ${ids.length} tab(s)${title === undefined ? '' : ` as "${title}"`}.`);
  }

  async function reopen(): Promise<Part[]> {
    await need('sessions', 'reopen the tab you closed last');
    const tab = await attempt('reopen a tab', () => actions.reopen());
    if (tab === null) return text('Nothing was recently closed, so nothing was reopened.');
    return text(`Reopened "${tab.title}" (${tab.url}).`);
  }

  /** The page to save: what the call names, else the tab the person is looking at. */
  async function pageToSave(
    input: Record<string, unknown>,
    waitMs: () => number,
  ): Promise<{ title: string; url: string }> {
    const { title, url } = input;
    if (typeof title === 'string' && typeof url === 'string') return { title, url };
    await need('tabs', 'see which tab is in front', waitMs());
    const active = await tabs.activeInFocusedWindow();
    if (active === null) throw failed('There is no active tab to save.');
    return {
      title: typeof title === 'string' ? title : active.title,
      url: typeof url === 'string' ? url : active.url,
    };
  }

  async function save(
    input: Record<string, unknown>,
    permission: OptionalPermission,
    reason: string,
    where: string,
    run: (title: string, url: string) => Promise<void>,
  ): Promise<Part[]> {
    // A url the model supplies is checked before anything is asked; the active tab's is not.
    if (input['url'] !== undefined) webAddress(input['url']);
    // One deadline for both questions, so they never outlast the brain's own timeout.
    const deadline = Date.now() + PERMISSION_WAIT_MS;
    const remaining = (): number => Math.max(0, deadline - Date.now());
    await need(permission, reason, remaining());
    const page = await pageToSave(input, remaining);
    await attempt(`save that to ${where}`, () => run(page.title, page.url));
    return text(`Saved "${page.title}" to ${where}.`);
  }

  return {
    tool: {
      name: 'tab_actions',
      description:
        'Do something with the browser tabs: open an address (http or https) or a web search in a ' +
        'new tab, close or switch to a tab by id, group tabs, reopen the tab last closed, add a ' +
        'bookmark, or add a page to the reading list. Bookmark and reading_list default to the ' +
        `tab the user is looking at. Get tab ids from the tabs tool. This is the ${bodyName} browser.`,
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['open', 'close', 'switch', 'group', 'reopen', 'bookmark', 'reading_list'],
          },
          url: {
            type: 'string',
            description: 'open: an http or https address. bookmark: page url.',
          },
          search: { type: 'string', description: 'open: web search text, instead of a url.' },
          tab_id: { type: 'number', description: 'close and switch: a tab id.' },
          tab_ids: { type: 'array', items: { type: 'number' }, description: 'group: tab ids.' },
          title: { type: 'string', description: 'group: group name. bookmark: page title.' },
        },
        required: ['action'],
      },
      effect: 'change',
    },
    async run(input) {
      switch (input['action']) {
        case 'open':
          return open(input);
        case 'close': {
          const id = tabIdOf(input['tab_id']);
          await attempt('close that tab', () => actions.close(id));
          return text(`Closed tab ${id}.`);
        }
        case 'switch': {
          const id = tabIdOf(input['tab_id']);
          await attempt('switch to that tab', () => actions.switchTo(id));
          return text(`Switched to tab ${id}.`);
        }
        case 'group':
          return group(input);
        case 'reopen':
          return reopen();
        case 'bookmark':
          return save(input, 'bookmarks', 'add a bookmark', 'your bookmarks', (t, u) =>
            actions.bookmark(t, u),
          );
        case 'reading_list':
          return save(
            input,
            'readingList',
            'add to your reading list',
            'your reading list',
            (t, u) => actions.addToReadingList(t, u),
          );
        default:
          throw invalid(
            'action must be "open", "close", "switch", "group", "reopen", "bookmark" or "reading_list"',
          );
      }
    },
  };
}
