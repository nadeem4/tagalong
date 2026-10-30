/**
 * Turns a right-click or an address-bar entry into what the person says to Scout. Pure, so it is
 * testable without Chrome. The page address loses its query and fragment (tokens live there), the
 * same as the tab fact.
 */
import { stripUrl } from './events';

export const MENU_ID = 'ask-scout';
export const MENU_TITLE = 'Ask Scout about this';

export interface Ask {
  text: string;
  context: { url: string; title: string };
}

type PageTab = { title?: string | undefined; url?: string | undefined } | undefined;

function ask(text: string, url: string | undefined, title: string | undefined): Ask | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return { text: trimmed, context: { url: stripUrl(url ?? ''), title: title ?? '' } };
}

/** A click with no selected text is not a question, so it asks nothing. */
export function fromMenuClick(
  info: { selectionText?: string | undefined; pageUrl?: string | undefined },
  tab: PageTab,
): Ask | null {
  return ask(info.selectionText ?? '', tab?.url ?? info.pageUrl, tab?.title);
}

export function fromOmnibox(typed: string, tab: PageTab): Ask | null {
  return ask(typed, tab?.url, tab?.title);
}
