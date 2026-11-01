/** Tests for Answer: Markdown rendering, links kept as text, and HTML kept as text. */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

  it('mutes list markers', () => {
    expect(ruleOf(ANSWER_CSS, '.answer li::marker')).toContain('color: #A3AAC4');
  });
});
