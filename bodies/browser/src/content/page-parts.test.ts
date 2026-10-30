// @vitest-environment jsdom
/** Tests for readParts: links, tables, headings and forms, and what a form must never leak. */
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PAGE_TEXT_CHARS } from './limits';
import { readParts } from './page-parts';

function body(html: string): void {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('readParts links', () => {
  it('links_lists_text_and_absolute_urls', () => {
    body('<a href="/docs">Docs</a><a href="https://other.test/x">Other</a>');
    const out = readParts(document, 'links').split('\n');
    expect(out).toContain(`Docs -> ${new URL('/docs', document.baseURI).href}`);
    expect(out).toContain('Other -> https://other.test/x');
  });

  it('links_skips_javascript_hrefs', () => {
    body(
      '<a href="javascript:alert(1)">Bad</a><a href="">Empty</a><a>None</a><a href="/ok">Ok</a>',
    );
    const out = readParts(document, 'links');
    expect(out).not.toContain('Bad');
    expect(out).not.toContain('Empty');
    expect(out).toContain('Ok ->');
  });
});

describe('readParts tables', () => {
  it('tables_are_tab_separated_with_a_heading_each', () => {
    body(
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>' +
        '<table><tr><td>x</td></tr></table>',
    );
    const out = readParts(document, 'tables');
    expect(out).toContain('Table 1\nA\tB\n1\t2');
    expect(out).toContain('Table 2\nx');
  });
});

describe('readParts headings', () => {
  it('headings_keep_their_level', () => {
    body('<h1>Top</h1><h2>Sub</h2><h3>Deep</h3>');
    expect(readParts(document, 'headings')).toBe('# Top\n## Sub\n### Deep');
  });
});

describe('readParts forms', () => {
  it('forms_list_field_labels_and_types_only', () => {
    body(`<form action="/login">
      <label for="u">Username</label><input id="u" type="text" value="hunter2">
      <input type="radio" name="plan" value="gold" checked>
      <input type="email" placeholder="Your email">
      <select name="country"><option value="x" selected>Narnia</option></select>
    </form>`);
    const out = readParts(document, 'forms');
    expect(out).toContain('/login');
    expect(out).toContain('Username (text)');
    expect(out).toContain('plan (radio)');
    expect(out).toContain('Your email (email)');
    expect(out).toContain('country (select)');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('gold');
    expect(out).not.toContain('Narnia');
  });

  it('forms_never_read_password_hidden_or_textarea_contents', () => {
    body(`<form>
      <input type="password" name="pw" value="s3cret">
      <input type="hidden" name="token" value="abc123">
      <textarea name="note">private words</textarea>
    </form>`);
    const out = readParts(document, 'forms');
    for (const leak of ['s3cret', 'abc123', 'private words']) expect(out).not.toContain(leak);
    expect(out).toContain('pw (password)');
    expect(out).toContain('note (textarea)');
    expect(out).not.toContain('token');
  });
});

describe('readParts limits', () => {
  it('output_is_capped_at_40000_with_the_note', () => {
    body(Array.from({ length: 3000 }, (_, i) => `<a href="/p${i}">link number ${i}</a>`).join(''));
    const out = readParts(document, 'links');
    expect(out.endsWith('[truncated at 40,000 characters]')).toBe(true);
    expect(out.length).toBeLessThan(MAX_PAGE_TEXT_CHARS + 100);
  });

  it('empty_page_part_says_there_are_none', () => {
    body('<p>nothing</p>');
    expect(readParts(document, 'tables')).toBe('There are no tables on this page.');
    expect(readParts(document, 'forms')).toBe('There are no forms on this page.');
  });
});
