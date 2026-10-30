/**
 * readPage: the selection and the readable main text of the page it runs in, using Readability
 * on a clone. Injected into the user's tab on demand only.
 */
import { Readability } from '@mozilla/readability';
// The zod-free subpath: this file is injected into the user's page, and the schemas would
// more than double what every read ships into the tab.
import { MAX_PAGE_TEXT_CHARS, MAX_SELECTION_CHARS } from '@tagalong/protocol/limits';

/** What the page reader hands back to the service worker. Plain data: it crosses a boundary. */
export interface PageReading {
  url: string;
  title: string;
  /** Exactly what the user selected, or empty. Never trimmed or reflowed. */
  selection: string;
  selectionTruncated: boolean;
  /** The readable main text, capped at the protocol's page limit. */
  text: string;
  truncated: boolean;
}

interface SelectionSource {
  getSelection(): Selection | null;
}

/**
 * Reads the page it runs in. Runs inside the user's tab, on demand only.
 *
 * Readability works on a clone, because it rewrites the document it is given and the page
 * is the user's, not ours. When it finds no article — a dashboard, a terminal in a tab, a
 * build log — the body's own text is the fallback: a pet told "nothing readable here" about
 * a page full of an error message is worse than one handed the raw text.
 */
export function readPage(doc: Document, win: SelectionSource): PageReading {
  const selection = readSelection(doc, win);
  const article = new Readability(doc.cloneNode(true) as Document).parse();
  const raw = article?.textContent ?? bodyText(doc);
  const text = tidy(raw);
  return {
    url: doc.location?.href ?? doc.URL,
    title: doc.title,
    selection: selection.slice(0, MAX_SELECTION_CHARS),
    selectionTruncated: selection.length > MAX_SELECTION_CHARS,
    text: text.slice(0, MAX_PAGE_TEXT_CHARS),
    truncated: text.length > MAX_PAGE_TEXT_CHARS,
  };
}

/**
 * The selection as the user made it. Text selected inside an input or textarea is not part
 * of the document selection, so the focused field is asked directly.
 */
function readSelection(doc: Document, win: SelectionSource): string {
  const active = doc.activeElement;
  if (isTextField(active)) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    if (end > start) return active.value.slice(start, end);
  }
  return win.getSelection()?.toString() ?? '';
}

function isTextField(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (element === null) return false;
  const tag = element.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  const type = (element as HTMLInputElement).type;
  return ['text', 'search', 'url', 'email', ''].includes(type);
}

function bodyText(doc: Document): string {
  const body = doc.body;
  if (body === null) return '';
  // innerText respects layout (hidden elements, line breaks); jsdom lacks it.
  return typeof body.innerText === 'string' && body.innerText.length > 0
    ? body.innerText
    : (body.textContent ?? '');
}

/**
 * Collapses the indentation and blank-line runs markup leaves behind, so the 40k budget is
 * spent on words. Paragraph breaks survive as single blank lines.
 */
function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
