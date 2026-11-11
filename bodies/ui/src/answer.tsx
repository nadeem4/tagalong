/**
 * How an answer reads in the bubble: Markdown rendered safely, and links kept as text.
 * Contains Answer and ANSWER_CSS.
 */

import { useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from './setup/icons';
import { themeTokens as t, typeCss } from './theme/tokens';

/**
 * A link stays text with its address on hover: a click inside the bubble's window would
 * navigate the window itself away from Tagalong.
 */
const LINK = ({ href, children }: { href?: string | undefined; children?: ReactNode }) => (
  <span className="answer-link" title={href}>
    {children}
  </span>
);

/** The text of a code block's children, for Copy. */
const textOf = (node: ReactNode): string =>
  typeof node === 'string'
    ? node
    : Array.isArray(node)
      ? node.map(textOf).join('')
      : node !== null && typeof node === 'object' && 'props' in node
        ? textOf((node as { props: { children?: ReactNode } }).props.children)
        : '';

/** A fenced block: a bar with its language and Copy over the code, as the chat mockup draws it. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = textOf(children).replace(/\n$/, '');
  const language = /language-([\w+-]+)/.exec(
    String((children as { props?: { className?: string } } | undefined)?.props?.className ?? ''),
  )?.[1];
  const copy = (): void => {
    void navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };
  return (
    <div className="answer-code">
      <div className="answer-code-bar" data-testid="code-bar">
        <span>{language ?? 'code'}</span>
        <button
          type="button"
          className="answer-copy"
          aria-label={copied ? 'Copied' : 'Copy'}
          onClick={copy}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

/** Links render as text, code blocks get their bar; everything else is react-markdown's default. */
const COMPONENTS: Components = { a: LINK, pre: CodeBlock };

/** The gist of a long answer: whole blocks up to about this many lines and characters. */
const GIST_LINES = 8;
const GIST_CHARS = 480;
const ITEM = /^\s*([-*+]|\d+[.)])\s/;

/** A piece of Markdown that is never cut: a paragraph, a code block, or one item of a list. */
interface Unit {
  lines: string[];
  /** It opens a block (a blank line goes before it). */
  opens: boolean;
}

/** The text as units: blocks split at blank lines (a fence stays whole), lists split into items. */
function unitsOf(text: string): Unit[] {
  const blocks: string[][] = [];
  let current: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (line.trim() === '' && !fenced) {
      if (current.length > 0) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks.flatMap((block): Unit[] => {
    if (!ITEM.test(block[0] ?? '')) return [{ lines: block, opens: true }];
    const items: Unit[] = [];
    for (const line of block) {
      if (ITEM.test(line) && !/^\s{2,}/.test(line)) items.push({ lines: [line], opens: false });
      else items[items.length - 1]?.lines.push(line);
    }
    if (items[0] !== undefined) items[0].opens = true;
    return items;
  });
}

/**
 * The lead of an answer and what comes with it, cut between blocks or between list items and
 * never inside one, so no bullet is half shown. The whole text comes back when nothing is left out.
 */
export function gistOf(text: string): string {
  const units = unitsOf(text);
  let lines = 0;
  let chars = 0;
  const kept: Unit[] = [];
  for (const unit of units) {
    const size = unit.lines.reduce((n, l) => n + l.length, 0);
    if (kept.length > 0 && (lines + unit.lines.length > GIST_LINES || chars + size > GIST_CHARS)) {
      break;
    }
    kept.push(unit);
    lines += unit.lines.length;
    chars += size;
  }
  if (kept.length === units.length) return text;
  return kept
    .map(
      (unit, i) => `${i > 0 && unit.opens ? '\n' : ''}${i > 0 ? '\n' : ''}${unit.lines.join('\n')}`,
    )
    .join('');
}

/**
 * An answer as people read it: the Markdown a model writes (bold, lists, headings, code,
 * tables) shown formatted, never as raw marks. HTML in an answer stays text.
 */
export function Answer({
  text,
  className,
  gist = false,
}: {
  text: string;
  className?: string;
  /** Fold a long answer to its lead behind Show more. */
  gist?: boolean;
}) {
  const [more, setMore] = useState(false);
  const lead = gist ? gistOf(text) : text;
  const long = lead !== text;
  const folded = long && !more;
  return (
    <>
      <div
        className={['answer', className].filter(Boolean).join(' ')}
        data-folded={folded || undefined}
      >
        <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS} skipHtml>
          {folded ? lead : text}
        </Markdown>
      </div>
      {long && (
        <button
          type="button"
          className="answer-more"
          aria-expanded={more}
          onClick={() => setMore(!more)}
        >
          {more ? 'Show less' : 'Show more'}
          <Icon name="chevDown" />
        </button>
      )}
    </>
  );
}

export const ANSWER_CSS = `
.answer { ${typeCss('bodyLead')}; overflow-wrap: anywhere; }
.answer > :first-child { margin-top: 0; }
.answer > :last-child { margin-bottom: 0; }
.answer p, .answer ul, .answer ol, .answer pre, .answer table { margin: 0 0 8px; }
.answer ul, .answer ol { flex: none; overflow: visible; padding: 0 0 0 ${t.space.xxl}px; }
.answer li { margin: 0; white-space: normal; }
.answer ul { list-style: disc; }
.answer ol { list-style: decimal; }
/* A folded answer fades out on its last line, so the cut reads as "there is more". */
.answer[data-folded] { position: relative; }
.answer[data-folded]::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 40px; pointer-events: none;
  background: linear-gradient(transparent, ${t.color.page});
}
.answer h1, .answer h2, .answer h3, .answer h4 { margin: 12px 0 6px; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; }
.answer h1, .answer h2 { ${typeCss('title')}; }
.answer code {
  padding: ${t.space.xxs}px ${t.space.sm}px; border-radius: ${t.radius.sm}px; background: ${t.color.tileNavy};
  font-family: ${t.font.mono}; ${typeCss('small')};
}
.answer pre {
  padding: 12px; border: 1px solid ${t.color.fieldLine}; border-radius: ${t.radius.sm}px; background: ${t.color.field};
  overflow-x: auto;
}
.answer li::marker { color: ${t.color.textMuted}; }
.answer pre code { padding: 0; background: none; }
.answer-code { margin: 0 0 8px; border: 1px solid ${t.color.fieldLine}; border-radius: ${t.radius.card}px; overflow: hidden; background: ${t.color.codeBg}; }
.answer-code-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px 6px 12px;
  border-bottom: 1px solid ${t.color.line}; background: ${t.color.field}; ${typeCss('small')}; color: ${t.color.textSoft};
  font-family: ${t.font.mono};
}
.answer-copy {
  min-height: 24px; padding: 0 8px; border: 0; border-radius: ${t.radius.sm}px; background: transparent;
  color: ${t.color.textMuted}; font: inherit; cursor: pointer;
}
.answer-copy:hover { background: ${t.color.tileNavy}; color: ${t.color.text}; }
.answer .answer-code pre { margin: 0; border: 0; border-radius: 0; background: transparent; white-space: pre-wrap; }
.answer-more {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; min-height: 28px; padding: 0 ${t.space.lg}px; border: 0; border-radius: 999px;
  background: ${t.color.tileNavy}; color: ${t.color.text}; font: inherit; ${typeCss('small')}; font-weight: 600; cursor: pointer;
}
.answer-more .cx-icon { flex: none; width: 14px; height: 14px; }
.answer-more[aria-expanded='true'] .cx-icon { transform: rotate(180deg); }
.answer blockquote { margin: 0 0 8px; padding-left: ${t.space.lg}px; border-left: 2px solid ${t.color.lineStrong}; color: ${t.color.textMuted}; }
.answer table { border-collapse: collapse; ${typeCss('body')}; }
.answer th, .answer td { padding: 4px 8px; border: 1px solid ${t.color.fieldLine}; text-align: left; }
.answer a, .answer .answer-link { color: ${t.color.sky}; text-decoration: underline; }
.answer hr { border: 0; border-top: 1px solid ${t.color.fieldLine}; margin: ${t.space.md}px 0; }
`;
