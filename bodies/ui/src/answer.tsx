/**
 * How an answer reads in the bubble: Markdown rendered safely, and links kept as text.
 * Contains Answer and ANSWER_CSS.
 */

import { useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
        <button type="button" className="answer-copy" aria-label={copied ? 'Copied' : 'Copy'} onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

/** Links render as text, code blocks get their bar; everything else is react-markdown's default. */
const COMPONENTS: Components = { a: LINK, pre: CodeBlock };

/** Past this many lines or characters an answer folds to its gist in the full chat. */
const GIST_LINES = 8;
const GIST_CHARS = 480;

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
  /** Fold a long answer to its first lines behind Show more. */
  gist?: boolean;
}) {
  const [more, setMore] = useState(false);
  const long = gist && (text.split('\n').length > GIST_LINES || text.length > GIST_CHARS);
  const folded = long && !more;
  const classes = ['answer', className, folded ? 'answer-gist' : undefined].filter(Boolean);
  return (
    <>
      <div className={classes.join(' ')}>
        <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS} skipHtml>
          {text}
        </Markdown>
      </div>
      {long && (
        <button type="button" className="answer-more" onClick={() => setMore(!more)}>
          {more ? 'Show less' : 'Show more'}
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
.answer ul, .answer ol { padding-left: 20px; }
.answer li + li { margin-top: 2px; }
.answer h1, .answer h2, .answer h3, .answer h4 { margin: 12px 0 6px; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; }
.answer h1, .answer h2 { ${typeCss('title')}; }
.answer code {
  padding: 1px 5px; border-radius: 4px; background: #222845;
  font-family: ${t.font.mono}; ${typeCss('small')};
}
.answer pre {
  padding: 12px; border: 1px solid ${t.color.fieldLine}; border-radius: 8px; background: ${t.color.field};
  overflow-x: auto;
}
.answer li::marker { color: ${t.color.textMuted}; }
.answer pre code { padding: 0; background: none; }
.answer-code { margin: 0 0 8px; border: 1px solid ${t.color.fieldLine}; border-radius: 10px; overflow: hidden; background: #0E1124; }
.answer-code-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px 6px 12px;
  border-bottom: 1px solid ${t.color.line}; background: ${t.color.field}; ${typeCss('small')}; color: #C9CEE0;
  font-family: ${t.font.mono};
}
.answer-copy {
  min-height: 24px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent;
  color: ${t.color.textMuted}; font: inherit; cursor: pointer;
}
.answer-copy:hover { background: #222845; color: ${t.color.text}; }
.answer .answer-code pre { margin: 0; border: 0; border-radius: 0; background: transparent; white-space: pre-wrap; }
.answer-more {
  align-self: flex-start; min-height: 28px; padding: 0 10px; border: 0; border-radius: 999px;
  background: #222845; color: ${t.color.text}; font: inherit; ${typeCss('small')}; font-weight: 600; cursor: pointer;
}
.answer blockquote { margin: 0 0 8px; padding-left: 10px; border-left: 2px solid #3A4270; color: ${t.color.textMuted}; }
.answer table { border-collapse: collapse; ${typeCss('body')}; }
.answer th, .answer td { padding: 4px 8px; border: 1px solid #2E3558; text-align: left; }
.answer a, .answer .answer-link { color: #7CB8F2; text-decoration: underline; }
.answer hr { border: 0; border-top: 1px solid #2E3558; margin: 10px 0; }
`;
