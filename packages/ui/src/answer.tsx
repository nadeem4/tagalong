import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { officeTokens as t } from './office/tokens';

/**
 * A link stays text with its address on hover: a click inside the bubble's window would
 * navigate the window itself away from Tagalong.
 */
const LINK = ({ href, children }: { href?: string | undefined; children?: ReactNode }) => (
  <span className="answer-link" title={href}>
    {children}
  </span>
);

/** The text of a hast node and everything under it. */
type HastLike = { type: string; value?: string; children?: HastLike[] };
function textOf(node: HastLike): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

/** How long Copy says Copied before it is Copy again. */
const COPIED_MS = 2000;

/**
 * A draft Scout wrote for the person: the text, framed, and Copy when the host can copy.
 * Copy only puts it on the clipboard; pasting it is the person's.
 */
function DraftBlock({
  text,
  onCopy,
}: {
  text: string;
  onCopy?: ((text: string) => Promise<void>) | undefined;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), COPIED_MS);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = (): void => {
    onCopy?.(text).then(
      () => setState('copied'),
      () => setState('failed'),
    );
  };
  return (
    <div className="answer-draft">
      <div className="answer-draft-text">{text}</div>
      {onCopy !== undefined && (
        <button type="button" className="answer-draft-copy" onClick={copy}>
          {state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : 'Copy'}
        </button>
      )}
    </div>
  );
}

/**
 * An answer as people read it: the Markdown a model writes (bold, lists, headings, code,
 * tables) shown formatted, never as raw marks. HTML in an answer stays text. A fenced
 * `draft` block is a draft for the person, shown with Copy when `onCopy` is given.
 */
export function Answer({
  text,
  className,
  onCopy,
}: {
  text: string;
  className?: string;
  onCopy?: ((text: string) => Promise<void>) | undefined;
}) {
  const components = useMemo<Components>(
    () => ({
      a: LINK,
      pre: ({ node, children }) => {
        const code = node?.children[0];
        const classes =
          code?.type === 'element' && code.tagName === 'code' ? code.properties.className : [];
        if (Array.isArray(classes) && classes.includes('language-draft')) {
          // The fence's closing newline is not part of the draft.
          return <DraftBlock text={textOf(code as HastLike).replace(/\n$/, '')} onCopy={onCopy} />;
        }
        return <pre>{children}</pre>;
      },
    }),
    [onCopy],
  );
  return (
    <div className={className === undefined ? 'answer' : `answer ${className}`}>
      <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
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
.answer .answer-draft {
  margin: 0 0 8px; padding: 10px 12px; border-radius: 8px;
  border: 1px solid ${t.color.fieldLine}; background: ${t.color.field};
}
.answer .answer-draft-text { white-space: pre-wrap; }
.answer .answer-draft-copy {
  margin-top: 8px; padding: 4px 12px; border: 0; border-radius: 6px; cursor: pointer;
  background: ${t.color.gold}; color: ${t.color.goldInk}; font: inherit; font-size: 13px; font-weight: 600;
}
.answer .answer-draft-copy:focus-visible { outline: 2px solid ${t.color.text}; outline-offset: 2px; }
`;
