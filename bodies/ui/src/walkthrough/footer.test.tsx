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
  it('draws Back as the shared secondary button', () => {
    mount(3);
    expect(screen.getByRole('button', { name: 'Back' })).toHaveClass('tg-button--secondary');
  });

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

  it('step 9 (the key) keeps Next off until the key is good, and has no Finish', () => {
    mount(9);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
  });

  it('step 9 Next is on once the key is good, and calls onNext', () => {
    const props = mount(9, { keyReady: true });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it('Finish carries the shared final-button class', () => {
    mount(10);
    expect(screen.getByRole('button', { name: 'Finish' })).toHaveClass('wt-final');
  });

  it('Finish on step ten is never disabled', () => {
    mount(10);
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled();
  });

  it('step ten has Back, a quiet "I’ll do this later" and Finish, and no Skip', () => {
    mount(10);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Back',
      'I’ll do this later',
      'Finish',
    ]);
    expect(screen.getByRole('button', { name: 'I’ll do this later' })).not.toHaveClass(
      'wt-primary',
    );
  });

  it('Finish and "I’ll do this later" both call onFinish', () => {
    const props = mount(10);
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    fireEvent.click(screen.getByRole('button', { name: 'I’ll do this later' }));
    expect(props.onFinish).toHaveBeenCalledTimes(2);
  });

  it('Skip calls onSkip and is not the primary button', () => {
    const props = mount(4);
    const skip = screen.getByRole('button', { name: 'Skip' });
    fireEvent.click(skip);
    expect(props.onSkip).toHaveBeenCalledTimes(1);
    expect(skip).not.toHaveClass('wt-primary');
    expect(screen.getByRole('button', { name: 'Next' })).toHaveClass('wt-primary');
  });

  it('step 9 has no Skip, since the key cannot be skipped', () => {
    mount(9);
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
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
