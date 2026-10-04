// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PAGE_TEXT_CHARS, MAX_SELECTION_CHARS } from '@tagalong/protocol';
import { readPage } from './read-page';

function article(paragraphs: string[]): string {
  return `<article><h1>Release notes</h1>${paragraphs.map((p) => `<p>${p}</p>`).join('')}</article>`;
}

const LONG_PARAGRAPH = 'Tagalong reads the page you are on so a pet can answer about it. '
  .repeat(20)
  .trim();

beforeEach(() => {
  document.title = 'Release notes — Example';
  document.body.innerHTML = `
    <nav>Home · Products · Pricing · Sign in</nav>
    ${article(Array.from({ length: 8 }, () => LONG_PARAGRAPH))}
    <footer>© Example Corp. Cookie settings.</footer>`;
  window.getSelection()?.removeAllRanges();
});

describe('readPage', () => {
  it('returns the URL and title of the page', () => {
    const reading = readPage(document, window);
    expect(reading.url).toBe(document.location.href);
    expect(reading.title).toBe('Release notes — Example');
  });

  it('extracts the readable article and leaves the chrome around it behind', () => {
    const reading = readPage(document, window);
    expect(reading.text).toContain('Tagalong reads the page you are on');
    expect(reading.text).not.toContain('Cookie settings');
    expect(reading.text).not.toContain('Pricing');
    expect(reading.truncated).toBe(false);
  });

  it('does not change the live page while reading it', () => {
    const before = document.body.innerHTML;
    readPage(document, window);
    expect(document.body.innerHTML).toBe(before);
  });

  it('caps page text at 40,000 characters and says it did', () => {
    document.body.innerHTML = article(Array.from({ length: 200 }, () => LONG_PARAGRAPH));
    const reading = readPage(document, window);
    expect(reading.text.length).toBe(MAX_PAGE_TEXT_CHARS);
    expect(reading.truncated).toBe(true);
  });

  it('falls back to the body text on a page Readability cannot make an article of', () => {
    document.body.innerHTML = '<div><span>Build failed: exit code 2</span></div>';
    const reading = readPage(document, window);
    expect(reading.text).toContain('Build failed: exit code 2');
  });

  // Passed through untouched: in Chrome, Selection.toString() is the text as rendered — what
  // the user sees highlighted and what Ctrl+C would copy — and the reader adds nothing to it.
  it('passes the selection through untouched, never trimming or reflowing it', () => {
    document.body.innerHTML = '<p id="p">  Line one,\n  “quoted” — line two.  </p>';
    const text = document.getElementById('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, text.textContent!.length - 2);
    window.getSelection()!.addRange(range);
    expect(readPage(document, window).selection).toBe('Line one,\n  “quoted” — line two.');
  });

  it('reads a selection inside a textarea, which the page selection does not include', () => {
    document.body.innerHTML = '<textarea id="t">draft: the exact words</textarea>';
    const area = document.getElementById('t') as HTMLTextAreaElement;
    area.focus();
    area.setSelectionRange(7, 22);
    expect(readPage(document, window).selection).toBe('the exact words');
  });

  it('reports no selection when nothing is selected', () => {
    expect(readPage(document, window).selection).toBe('');
  });

  it('keeps a selection whole up to the protocol limit and truncates beyond it', () => {
    document.body.innerHTML = `<p id="p">${'x'.repeat(MAX_SELECTION_CHARS + 50)}</p>`;
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('p')!);
    window.getSelection()!.addRange(range);
    const reading = readPage(document, window);
    expect(reading.selection.length).toBe(MAX_SELECTION_CHARS);
    expect(reading.selectionTruncated).toBe(true);
  });
});
