import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SightPermission } from './sight-permission';

describe('SightPermission', () => {
  it('offers When I ask and Always, each with a plain explanation', () => {
    render(<SightPermission value="when-asked" onChange={() => {}} />);

    expect(screen.getByRole('radio', { name: /When I ask/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Always/ })).not.toBeChecked();
    expect(screen.getByText(/only when you press a look key/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is sent until you ask/i)).toBeInTheDocument();
  });

  it('shows the saved choice', () => {
    render(<SightPermission value="always" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: /Always/ })).toBeChecked();
  });

  it('reports the new choice', () => {
    const onChange = vi.fn();
    render(<SightPermission value="when-asked" onChange={onChange} />);

    fireEvent.click(screen.getByRole('radio', { name: /Always/ }));
    expect(onChange).toHaveBeenCalledWith('always');
  });

  it('is one labelled group', () => {
    render(<SightPermission value="when-asked" onChange={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Sight permission' })).toBeInTheDocument();
  });
});
