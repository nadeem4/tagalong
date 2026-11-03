/**
 * Safe Markdown for reports and Scout's result: react-markdown with GFM (so tables are tables),
 * which builds React elements only. Raw HTML is skipped, links keep to http(s), images are never
 * drawn (their alt text is kept) and headings start at h3 under the page's own headings.
 * Contains SafeMarkdown.
 */
import type { ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Props = { children?: ReactNode };

// Report headings sit under the page's h1 and tab heading, so # becomes h3 (h6 stays h6).
const heading = (tag: 'h3' | 'h4' | 'h5' | 'h6') => {
  const Tag = tag;
  return ({ children }: Props) => <Tag>{children}</Tag>;
};

const COMPONENTS: Components = {
  h1: heading('h3'),
  h2: heading('h4'),
  h3: heading('h5'),
  h4: heading('h6'),
  h5: heading('h6'),
  h6: heading('h6'),
  a: ({ href, children }: Props & { href?: string | undefined }) =>
    /^https?:\/\//i.test(href ?? '') ? (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  img: ({ alt }: { alt?: string | undefined }) => <>{alt ?? ''}</>,
  // A wide table scrolls inside its own box instead of stretching the page.
  table: ({ children }: Props) => (
    <div className="safe-md__table">
      <table>{children}</table>
    </div>
  ),
};

export function SafeMarkdown({ text }: { text: string }) {
  return (
    <div className="safe-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={COMPONENTS}
        // Unsafe schemes never become a url; the link component then drops them to text.
        urlTransform={(url) => (/^https?:\/\//i.test(url) ? url : '')}
        skipHtml
      >
        {text}
      </Markdown>
    </div>
  );
}
