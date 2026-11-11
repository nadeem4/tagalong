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
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
