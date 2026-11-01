/** Tests for Toggle: switch role, aria-checked, one change per press, disabled, On/Off word. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toggle } from './toggle';

describe('Toggle', () => {
  it('exposes role switch with aria-checked', () => {
    const { rerender } = render(<Toggle checked={false} onChange={() => {}} label="Voice" />);
    const toggle = screen.getByRole('switch', { name: 'Voice' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    rerender(<Toggle checked onChange={() => {}} label="Voice" />);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('is a type=button so it never submits a form', () => {
    render(<Toggle checked={false} onChange={() => {}} label="Voice" />);
    expect(screen.getByRole('switch')).toHaveAttribute('type', 'button');
  });

  it('asks for the opposite value once per press (the browser turns Space and Enter into a click)', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Voice" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('disabled ignores clicks and is aria-disabled', () => {
    const onChange = vi.fn();
    render(<Toggle checked onChange={onChange} label="Voice" disabled />);
    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows On or Off text', () => {
    const { rerender } = render(<Toggle checked={false} onChange={() => {}} label="Voice" />);
    expect(screen.getByText('Off')).toBeInTheDocument();
    rerender(<Toggle checked onChange={() => {}} label="Voice" />);
    expect(screen.getByText('On')).toBeInTheDocument();
  });
});
