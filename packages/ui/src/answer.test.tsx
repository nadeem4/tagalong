/** Tests for Answer: Markdown rendering, links kept as text, and drafts with Copy. */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Answer } from './answer';

const REPLY = [
  'You are in **ai_pet**, on `engine.test.ts`.',
  '',
  '## What I see',
  '',
  '- One test fails',
  '- *Two* are skipped',
  '',
  '1. Fix the timeout',
  '2. Run the tests',
  '',
  '```ts',
  'await engine.stop();',
  '```',
  '',
  'See [the docs](https://example.com/docs).',
].join('\n');

describe('Answer', () => {
  it('shows Markdown as formatted text, never the raw marks', () => {
    const { container } = render(<Answer text={REPLY} />);
    expect(screen.getByText('ai_pet').tagName).toBe('STRONG');
    expect(screen.getByText('engine.test.ts').tagName).toBe('CODE');
    expect(screen.getByRole('heading', { name: 'What I see' })).toBeVisible();
    const lists = screen.getAllByRole('list');
    expect(lists.map((list) => list.tagName)).toEqual(['UL', 'OL']);
    expect(screen.getByText('Two').tagName).toBe('EM');
    expect(container.querySelector('pre code')).toHaveTextContent('await engine.stop();');
    expect(container.textContent).not.toMatch(/\*\*|^- |##|```/m);
  });

  it('shows a link as text with its address, so a click never leaves the bubble', () => {
    const { container } = render(<Answer text={'See [the docs](https://example.com/docs).'} />);
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('the docs')).toHaveAttribute('title', 'https://example.com/docs');
  });

  it('shows HTML in an answer as text, never as markup', () => {
    const { container } = render(<Answer text={'<b>hi</b><script>alert(1)</script>'} />);
    expect(container.querySelector('b, script')).toBeNull();
  });

  it('renders tables', () => {
    render(<Answer text={'| a | b |\n| - | - |\n| 1 | 2 |'} />);
    expect(screen.getByRole('table')).toBeVisible();
  });
});

const DRAFTED = [
  "Here's a draft. Copy it and paste it in.",
  '',
  '```draft',
  'Hi Sam,',
  '',
  'Yes, Friday works.',
  '```',
].join('\n');

describe('Answer, a draft', () => {
  it("Copy passes the draft's exact text, without the fences", async () => {
    const onCopy = vi.fn(() => Promise.resolve());
    render(<Answer text={DRAFTED} onCopy={onCopy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(onCopy).toHaveBeenCalledWith('Hi Sam,\n\nYes, Friday works.');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible();
  });

  it('shows the draft framed, with its text', () => {
    const { container } = render(<Answer text={DRAFTED} onCopy={vi.fn()} />);
    expect(container.querySelector('.answer-draft')).toHaveTextContent('Yes, Friday works.');
  });

  it('gives a code block no Copy button and keeps it a code block', () => {
    const { container } = render(
      <Answer text={'```ts\nawait engine.stop();\n```'} onCopy={vi.fn()} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('pre > code.language-ts')).toHaveTextContent(
      'await engine.stop();',
    );
    expect(container.querySelector('.answer-draft')).toBeNull();
  });

  it('keeps a fenced block with no language a code block', () => {
    const { container } = render(<Answer text={'```\nnpm test\n```'} onCopy={vi.fn()} />);
    expect(container.querySelector('pre > code')).toHaveTextContent('npm test');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows no Copy button when the host cannot copy', () => {
    const { container } = render(<Answer text={DRAFTED} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('.answer-draft')).toHaveTextContent('Hi Sam,');
  });

  it('goes back to Copy 2 s after it copied', async () => {
    vi.useFakeTimers();
    try {
      render(<Answer text={DRAFTED} onCopy={() => Promise.resolve()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
      act(() => vi.advanceTimersByTime(1999));
      expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByRole('button', { name: 'Copy' })).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says it couldn't copy when the copy failed", async () => {
    const onCopy = vi.fn(() => Promise.reject(new Error('too long')));
    render(<Answer text={DRAFTED} onCopy={onCopy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: "Couldn't copy" })).toBeVisible();
  });
});
