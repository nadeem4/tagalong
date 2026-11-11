/** Tests for SearchField: the full-width search box and its announced Searching… line. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchField } from './search-field';

describe('SearchField', () => {
  it('is a labelled search box with the placeholder and reports typing', () => {
    const onChange = vi.fn();
    render(
      <SearchField
        label="Search apps"
        placeholder="Notion, Linear…"
        value=""
        onChange={onChange}
      />,
    );
    const input = screen.getByRole('searchbox', { name: 'Search apps' });
    expect(input.getAttribute('placeholder')).toBe('Notion, Linear…');
    fireEvent.change(input, { target: { value: 'lin' } });
    expect(onChange).toHaveBeenCalledWith('lin');
  });

  it('Searching… is announced while loading and gone after', () => {
    const { rerender } = render(
      <SearchField label="Search apps" placeholder="" value="x" onChange={vi.fn()} loading />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Searching…');
    rerender(<SearchField label="Search apps" placeholder="" value="x" onChange={vi.fn()} />);
    // The live region always exists, so a screen reader hears text added to it; idle it is empty.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('shows a note on the same line when not loading, and Searching… wins while loading', () => {
    const { rerender } = render(
      <SearchField label="s" placeholder="" value="x" onChange={vi.fn()} note='Results for "x"' />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Results for "x"');
    rerender(
      <SearchField
        label="s"
        placeholder=""
        value="x"
        onChange={vi.fn()}
        note='Results for "x"'
        loading
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Searching…');
    expect(screen.getByRole('status')).not.toHaveTextContent('Results for');
  });
});
