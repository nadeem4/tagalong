/**
 * Tests for SafeMarkdown: Markdown with GFM tables, built from React elements so raw HTML in a
 * report is skipped, links keep to http(s), and images are never drawn.
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

  it('skips raw html', () => {
    const { container } = render(
      <SafeMarkdown text={'<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container).not.toHaveTextContent('alert(1)');
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

  it('renders a Claude-style table with alignment, escaped pipes and bold cells', () => {
    const text = [
      'Name | Count | Note',
      ':--- | ---: | :---:',
      '`a\\|b` | **12** | ok',
      'plain | 3 | fine',
    ].join('\n');
    const { container } = render(<SafeMarkdown text={text} />);
    expect(container.querySelector('pre')).toBeNull();
    expect(container.querySelectorAll('th')).toHaveLength(3);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.querySelector('td code')).toHaveTextContent('a|b');
    expect(container.querySelector('td strong')).toHaveTextContent('12');
    expect(container.querySelector('.safe-md__table table')).not.toBeNull();
  });

  it('renders a table inside a list item', () => {
    const text = '- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n';
    const { container } = render(<SafeMarkdown text={text} />);
    expect(container.querySelector('li table td')).toHaveTextContent('1');
  });

  it('renders a table with CRLF line endings', () => {
    const text = '| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n';
    const { container } = render(<SafeMarkdown text={text} />);
    expect(container.querySelectorAll('td')).toHaveLength(2);
    expect(container.querySelector('pre')).toBeNull();
  });

  it('renders 100 KB in under 2 s', () => {
    const text = 'A line of **report** text with `code` and [a link](https://x.io).\n\n'.repeat(
      1500,
    );
    expect(text.length).toBeGreaterThan(95_000);
    const start = performance.now();
    render(<SafeMarkdown text={text} />);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('renders 200 KB of unclosed brackets on one line in under 2 s', () => {
    const start = performance.now();
    render(<SafeMarkdown text={'['.repeat(200_000)} />);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('never uses dangerouslySetInnerHTML', () => {
    const source = readFileSync(join(import.meta.dirname, 'safe-markdown.tsx'), 'utf8');
    expect(source).not.toMatch(/dangerously/i);
  });
});
