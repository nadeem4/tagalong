/** Tests for the walkthrough footer: Back, one quiet Skip link and the primary Next or Finish. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Footer } from './footer';

function mount(step: number, extra: Partial<Parameters<typeof Footer>[0]> = {}) {
  const props = {
    step,
    busy: false,
    error: '',
    onBack: vi.fn(),
    onNext: vi.fn(),
    onSkip: vi.fn(),
    onFinish: vi.fn(),
    ...extra,
  };
  render(<Footer {...props} />);
  return props;
}

describe('Footer', () => {
  it('shows Back, Skip and Next only (no third button)', () => {
    mount(3);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Back',
      'Skip',
      'Next',
    ]);
  });

  it('step 1 hides Back and labels Next "Get started"', () => {
    mount(1);
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get started' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('step 9 labels Next "Finish" and keeps it off until the key is good', () => {
    mount(9);
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled();
  });

  it('step 9 Finish is on once canFinish, and calls onFinish', () => {
    const props = mount(9, { canFinish: true });
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(props.onFinish).toHaveBeenCalledTimes(1);
  });

  it('Skip calls onSkip and is not the primary button', () => {
    const props = mount(4);
    const skip = screen.getByRole('button', { name: 'Skip' });
    fireEvent.click(skip);
    expect(props.onSkip).toHaveBeenCalledTimes(1);
    expect(skip).not.toHaveClass('wt-primary');
    expect(screen.getByRole('button', { name: 'Next' })).toHaveClass('wt-primary');
  });

  it('Back and Next call their handlers; busy disables all three', () => {
    const props = mount(4);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it('shows an error as an alert', () => {
    mount(4, { error: 'That shortcut is taken.' });
    expect(screen.getByRole('alert')).toHaveTextContent('That shortcut is taken.');
  });
});
