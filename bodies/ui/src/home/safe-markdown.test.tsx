/**
 * Tests for SafeMarkdown: the subset of Markdown a report may use, built from React elements so
 * HTML in a report is only ever text, links keep to http(s), and images are never drawn.
 */

import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SafeMarkdown } from './safe-markdown';

describe('SafeMarkdown', () => {
  it('renders headings lists and code', () => {
    const text = [
      '# Title',
      '',
      'Some **bold** and *soft* and `code`.',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '2. second',
      '',
      '```js',
      'let a = 1;',
      '```',
      '',
      '> quoted',
    ].join('\n');
    const { container } = render(<SafeMarkdown text={text} />);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(container.querySelector('strong')).toHaveTextContent('bold');
    expect(container.querySelector('em')).toHaveTextContent('soft');
    expect(container.querySelector('p code')).toHaveTextContent('code');
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.querySelector('pre code')).toHaveTextContent('let a = 1;');
    expect(container.querySelector('blockquote')).toHaveTextContent('quoted');
  });

  it('renders html as text', () => {
    const { container } = render(
      <SafeMarkdown text={'<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('<script>alert(1)</script>');
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  it('drops javascript and data links to plain text', () => {
    const { container } = render(
      <SafeMarkdown
        text={'[a](javascript:alert(1)) and [b](data:text/html,hi) and [c](JavaScript:x)'}
      />,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container).toHaveTextContent('a and b and c');
  });

  it('links open in a new tab with noreferrer', () => {
    render(<SafeMarkdown text="[docs](https://example.com/x) and [http](http://example.com)" />);
    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    expect(screen.getByRole('link', { name: 'http' })).toBeInTheDocument();
  });

  it('does not render images', () => {
    const { container } = render(<SafeMarkdown text="![alt text](https://example.com/a.png)" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container).toHaveTextContent('alt text');
  });

  it('handles an unterminated code fence', () => {
    const { container } = render(<SafeMarkdown text={'text\n\n```\nnever closed\nstill code'} />);
    expect(container.querySelector('pre')).toHaveTextContent('never closed');
  });

  it('renders tables as preformatted text', () => {
    const { container } = render(<SafeMarkdown text={'| a | b |\n|---|---|\n| 1 | 2 |'} />);
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('pre')).toHaveTextContent('| 1 | 2 |');
  });

  it('renders 200 KB in under 2 s', () => {
    const text = 'A line of **report** text with `code` and [a link](https://x.io).\n'.repeat(3000);
    expect(text.length).toBeGreaterThan(190_000);
    const start = performance.now();
    render(<SafeMarkdown text={text} />);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('never uses dangerouslySetInnerHTML', () => {
    const source = readFileSync(join(import.meta.dirname, 'safe-markdown.tsx'), 'utf8');
    expect(source).not.toMatch(/dangerously/i);
  });
});
