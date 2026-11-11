/** Tests for Answer: Markdown rendering, links kept as text, and HTML kept as text. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ANSWER_CSS, Answer } from './answer';
import { minPadding, ruleOf } from './test-support/css-rules';

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

describe('ANSWER_CSS', () => {
  it('gives a code block a hairline edge and 12px inside', () => {
    expect(ruleOf(ANSWER_CSS, '.answer pre')).toContain('border: 1px solid #2E3558');
    expect(minPadding(ANSWER_CSS, '.answer pre')).toBeGreaterThanOrEqual(12);
  });

  it('keeps bullets and numbers visible whatever the page resets', () => {
    expect(ruleOf(ANSWER_CSS, '.answer ul')).toContain('list-style: disc');
    expect(ruleOf(ANSWER_CSS, '.answer ol')).toContain('list-style: decimal');
  });

  it('mutes list markers', () => {
    expect(ruleOf(ANSWER_CSS, '.answer li::marker')).toContain('color: #A3AAC4');
  });
});

describe('Answer code blocks', () => {
  it('draws a code block under a bar with its language and a Copy button', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Answer text={'```ts\nawait engine.stop();\n```'} />);
    expect(screen.getByTestId('code-bar')).toHaveTextContent('ts');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('await engine.stop();');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible();
  });

  it('keeps inline code as plain code', () => {
    render(<Answer text="run `pnpm test`" />);
    expect(screen.queryByTestId('code-bar')).toBeNull();
  });
});

describe('Answer gist', () => {
  const LONG = Array.from({ length: 12 }, (_, i) => `- point number ${i}`).join('\n');
  const GIST_THEN_CODE = [
    '**The test never picks a folder.** Yesterday it started to matter.',
    '',
    '- Fix: set a folder in the fixture.',
    '- Three other tests pass too.',
    '',
    `More detail about how the tools check folders, and why it changed. ${'It is long. '.repeat(40)}`,
    '',
    '```ts',
    'const home = await tmpHome();',
    '```',
  ].join('\n');

  it('a long answer shows its gist with Show more, and Show less folds it back', () => {
    const { container } = render(<Answer text={LONG} gist />);
    expect(container.querySelector('[data-folded]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(container.querySelector('[data-folded]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(container.querySelector('[data-folded]')).not.toBeNull();
  });

  it('shows the lead and its bullets whole, and the rest only after Show more', () => {
    render(<Answer text={GIST_THEN_CODE} gist />);
    expect(screen.getByText('Fix: set a folder in the fixture.')).toBeVisible();
    expect(screen.getByText('Three other tests pass too.')).toBeVisible();
    expect(screen.queryByText(/More detail about/)).toBeNull();
    expect(screen.queryByTestId('code-bar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getByTestId('code-bar')).toBeVisible();
  });

  it('never cuts a bullet: a long list shows whole items only', () => {
    render(<Answer text={LONG} gist />);
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(12);
    for (const item of items) expect(item.textContent).toMatch(/^point number \d+$/);
  });

  it('Show more is a link-like control with a chevron', () => {
    render(<Answer text={LONG} gist />);
    expect(screen.getByRole('button', { name: 'Show more' }).querySelector('svg')).not.toBeNull();
  });

  it('a short answer has no Show more, and gist is opt-in', () => {
    render(<Answer text="Short." gist />);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    render(<Answer text={LONG} />);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('one long paragraph is the gist itself: nothing to fold', () => {
    render(<Answer text={'word '.repeat(300)} gist />);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});
