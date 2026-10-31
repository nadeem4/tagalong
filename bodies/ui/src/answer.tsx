/**
 * How an answer reads in the bubble: Markdown rendered safely, and links kept as text.
 * Contains Answer and ANSWER_CSS.
 */

import type { ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { themeTokens as t } from './theme/tokens';

/**
 * A link stays text with its address on hover: a click inside the bubble's window would
 * navigate the window itself away from Tagalong.
 */
const LINK = ({ href, children }: { href?: string | undefined; children?: ReactNode }) => (
  <span className="answer-link" title={href}>
    {children}
  </span>
);

/** Links render as text; everything else is react-markdown's default. */
const COMPONENTS: Components = { a: LINK };

/**
 * An answer as people read it: the Markdown a model writes (bold, lists, headings, code,
 * tables) shown formatted, never as raw marks. HTML in an answer stays text.
 */
export function Answer({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className === undefined ? 'answer' : `answer ${className}`}>
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS} skipHtml>
        {text}
      </Markdown>
    </div>
  );
}

export const ANSWER_CSS = `
.answer { font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.answer > :first-child { margin-top: 0; }
.answer > :last-child { margin-bottom: 0; }
.answer p, .answer ul, .answer ol, .answer pre, .answer table { margin: 0 0 8px; }
.answer ul, .answer ol { padding-left: 20px; }
.answer li + li { margin-top: 2px; }
.answer h1, .answer h2, .answer h3, .answer h4 { margin: 12px 0 6px; font-size: 14px; font-weight: 600; }
.answer h1, .answer h2 { font-size: 15px; }
.answer code {
  padding: 1px 5px; border-radius: 4px; background: #222845;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace; font-size: 12.5px;
}
.answer pre { padding: 10px 12px; border-radius: 8px; background: ${t.color.field}; overflow-x: auto; }
.answer pre code { padding: 0; background: none; }
.answer blockquote { margin: 0 0 8px; padding-left: 10px; border-left: 2px solid #3A4270; color: ${t.color.textMuted}; }
.answer table { border-collapse: collapse; font-size: 13px; }
.answer th, .answer td { padding: 4px 8px; border: 1px solid #2E3558; text-align: left; }
.answer a, .answer .answer-link { color: #7CB8F2; text-decoration: underline; }
.answer hr { border: 0; border-top: 1px solid #2E3558; margin: 10px 0; }
`;
