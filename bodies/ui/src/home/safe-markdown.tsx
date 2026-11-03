/**
 * Safe Markdown for reports and Scout's result: a small line-based parser that builds React
 * elements only, so HTML in a report is shown as text. Links keep to http(s), images are never
 * drawn (their alt text is kept), tables stay preformatted. Contains SafeMarkdown.
 */
import { Fragment, type ReactNode } from 'react';

const INLINE =
  /(`[^`\n]+`)|(!?\[[^\]\n]*\]\((?:[^()\s]|\([^()\s]*\))*\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g;
const LINK = /^(!?)\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)$/;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    const raw = m[0];
    if (m[1]) out.push(<code key={key++}>{raw.slice(1, -1)}</code>);
    else if (m[2]) {
      const [, image, label, href] = LINK.exec(raw) ?? [];
      if (image === '' && /^https?:\/\//i.test(href ?? '')) {
        out.push(
          <a key={key++} href={href} target="_blank" rel="noreferrer noopener">
            {label}
          </a>,
        );
      } else out.push(label);
    } else if (m[3]) out.push(<strong key={key++}>{raw.slice(2, -2)}</strong>);
    else out.push(<em key={key++}>{raw.slice(1, -1)}</em>);
    last = at + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const isTable = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line);

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const startsBlock = (line: string): boolean =>
    line.trim() === '' ||
    line.startsWith('```') ||
    HEADING.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    line.startsWith('>') ||
    isTable(line);
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i++;
    } else if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) code.push(lines[i++] ?? '');
      i++; // the closing fence, if there was one
      out.push(
        <pre key={key++}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
    } else if (HEADING.test(line)) {
      const [, hashes, body] = HEADING.exec(line) ?? [];
      // Report headings sit under the page's own h1 and tab heading, so they start at h3.
      const Tag = `h${Math.min(6, (hashes?.length ?? 1) + 2)}` as 'h3';
      out.push(<Tag key={key++}>{inline(body ?? '')}</Tag>);
      i++;
    } else if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = NUMBERED.test(line) && !BULLET.test(line);
      const re = ordered ? NUMBERED : BULLET;
      const items: ReactNode[] = [];
      while (i < lines.length && re.test(lines[i] ?? '')) {
        items.push(<li key={items.length}>{inline(re.exec(lines[i] ?? '')?.[1] ?? '')}</li>);
        i++;
      }
      out.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
    } else if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('>')) {
        quote.push((lines[i++] ?? '').replace(/^>\s?/, ''));
      }
      out.push(<blockquote key={key++}>{inline(quote.join(' '))}</blockquote>);
    } else if (isTable(line)) {
      const rows: string[] = [];
      while (i < lines.length && isTable(lines[i] ?? '')) rows.push(lines[i++] ?? '');
      out.push(<pre key={key++}>{rows.join('\n')}</pre>);
    } else {
      const para: string[] = [];
      while (i < lines.length && !startsBlock(lines[i] ?? '')) para.push(lines[i++] ?? '');
      out.push(
        <p key={key++}>
          {para.map((p, n) => (
            <Fragment key={n}>
              {n > 0 && ' '}
              {inline(p)}
            </Fragment>
          ))}
        </p>,
      );
    }
  }
  return out;
}

export function SafeMarkdown({ text }: { text: string }) {
  return <div className="safe-md">{blocks(text)}</div>;
}
