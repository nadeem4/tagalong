/**
 * The `page_parts` tool: the links, tables, headings or form shape of a tab's page. Same
 * tab rules and permission order as `tabs` read; forms never include what was typed.
 */
import type { PartKind } from '../content/page-parts';
import type { PageApi, TabsApi } from '../layer/api';
import { failed, invalid, type BrowserTool } from './registry';
import { resolveReadableTab, type Needs } from './tabs';

interface PagePartsDeps {
  tabs: TabsApi;
  page: PageApi;
  needs: Needs;
  bodyName: string;
}

const PARTS: readonly PartKind[] = ['links', 'tables', 'forms', 'headings'];

export function pagePartsTool(deps: PagePartsDeps): BrowserTool {
  return {
    tool: {
      name: 'page_parts',
      description:
        'Get one kind of structure from a page: its links, tables, forms (field names and ' +
        'types only, never what was typed) or headings. Use it when the plain page text ' +
        'from "tabs" read is not enough. Leave tab_id out to use the tab the user is ' +
        `looking at. This is the ${deps.bodyName} browser.`,
      input_schema: {
        type: 'object',
        properties: {
          part: { type: 'string', enum: [...PARTS] },
          tab_id: {
            type: 'number',
            description: 'A tab id from tabs list. Default: the active tab.',
          },
        },
        required: ['part'],
      },
      effect: 'read',
    },
    async run(input) {
      const part = input['part'];
      if (!PARTS.includes(part as PartKind)) {
        throw invalid('part must be "links", "tables", "forms" or "headings"');
      }
      const tab = await resolveReadableTab(deps, input['tab_id'], 'read a tab');
      try {
        const text = await deps.page.parts(tab.id, part as PartKind);
        return [{ type: 'text', text }];
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        throw failed(`I could not read that tab: ${why}`);
      }
    },
  };
}
