/**
 * Tests for WatchList: Scout's watch list for a job as the owner sees it, read-only. Nothing for
 * none or empty, one item per entry with a done glyph, text kept as plain text.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WatchList } from './watch-list';

describe('WatchList', () => {
  it('renders nothing for null or an empty list', () => {
    const { container, rerender } = render(<WatchList items={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<WatchList items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one list item per entry with a done glyph', () => {
    render(
      <WatchList
        items={[
          { text: 'tests pass', done: true },
          { text: 'README updated', done: false },
        ]}
      />,
    );
    expect(screen.getByText('Scout is checking')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('tests pass');
    expect(screen.getByLabelText('done')).toBeInTheDocument();
    expect(screen.getByLabelText('not done')).toBeInTheDocument();
  });

  it('shows item text as plain text, not markup', () => {
    render(<WatchList items={[{ text: '<b>x</b> <script>1</script>', done: false }]} />);
    expect(screen.getByText('<b>x</b> <script>1</script>')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
  });

  it('has no buttons or inputs (read-only)', () => {
    render(<WatchList items={[{ text: 'a', done: false }]} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
