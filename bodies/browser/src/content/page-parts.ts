/**
 * Reads one kind of structure from a page: links, tables, headings or the shape of forms.
 * Injected into the user's tab, so it imports only limits. Forms report field names and
 * types, never what the person typed or chose.
 */
import { MAX_PAGE_TEXT_CHARS } from './limits';

export type PartKind = 'links' | 'tables' | 'forms' | 'headings';

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

function links(doc: Document): string[] {
  const out: string[] = [];
  for (const a of Array.from(doc.querySelectorAll('a'))) {
    const raw = a.getAttribute('href');
    if (raw === null || raw.trim() === '' || a.protocol === 'javascript:') continue;
    out.push(`${clean(a.textContent) || a.href} -> ${a.href}`);
  }
  return out;
}

function tables(doc: Document): string[] {
  return Array.from(doc.querySelectorAll('table')).map((table, i) => {
    const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th, td'))
        .map((cell) => clean(cell.textContent))
        .join('\t'),
    );
    return [`Table ${i + 1}`, ...rows].join('\n');
  });
}

function headings(doc: Document): string[] {
  return Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(
    (h) => `${'#'.repeat(Number(h.tagName.slice(1)))} ${clean(h.textContent)}`,
  );
}

const SKIPPED_INPUTS = ['hidden', 'submit', 'button', 'reset', 'image'];

function fieldLabel(doc: Document, el: Element): string {
  const id = el.getAttribute('id');
  const byFor = id === null ? null : doc.querySelector(`label[for="${CSS.escape(id)}"]`);
  const text = clean(byFor?.textContent ?? el.closest('label')?.textContent);
  return (
    text ||
    clean(el.getAttribute('aria-label')) ||
    clean(el.getAttribute('placeholder')) ||
    clean(el.getAttribute('name')) ||
    clean(id)
  );
}

function forms(doc: Document): string[] {
  return Array.from(doc.querySelectorAll('form')).map((form, i) => {
    const lines = [`Form ${i + 1}: ${form.getAttribute('action') ?? '(no action)'}`];
    for (const el of Array.from(form.querySelectorAll('input, select, textarea'))) {
      const tag = el.tagName.toLowerCase();
      const type = tag === 'input' ? (el.getAttribute('type') ?? 'text').toLowerCase() : tag;
      if (tag === 'input' && SKIPPED_INPUTS.includes(type)) continue;
      lines.push(`  ${fieldLabel(doc, el) || '(unnamed)'} (${type})`);
    }
    return lines.join('\n');
  });
}

const READERS: Record<PartKind, (doc: Document) => string[]> = {
  links,
  tables,
  forms,
  headings,
};

/** The page's parts of one kind as plain text, capped like a page read. */
export function readParts(doc: Document, kind: PartKind): string {
  const items = READERS[kind](doc);
  if (items.length === 0) return `There are no ${kind} on this page.`;
  const text = items.join(kind === 'forms' || kind === 'tables' ? '\n\n' : '\n');
  if (text.length <= MAX_PAGE_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_PAGE_TEXT_CHARS)}\n[truncated at 40,000 characters]`;
}
