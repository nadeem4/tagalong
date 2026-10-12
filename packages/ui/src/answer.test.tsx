import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
