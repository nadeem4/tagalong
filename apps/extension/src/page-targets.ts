/** What the panel and the shortcut read from a tab: the selection, the page, and which tab. */
import type { PerceptionTarget } from '@tagalong/protocol';

export const PAGE_TARGETS: readonly PerceptionTarget[] = ['selection', 'pageText', 'activeWindow'];
