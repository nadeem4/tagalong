import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import { PetAvatar } from './pet-avatar';

const sage: Pet = {
  id: 'sage',
  name: 'Sage',
  avatar: '🦊',
  persona: 'a calm explainer',
  model: 'claude-opus-5',
  providerId: 'anthropic',
  toolAllowlist: [],
  replyStyle: 'text',
};

describe('PetAvatar', () => {
  it('renders an emoji avatar labelled with the pet name and state', () => {
    render(<PetAvatar pet={sage} state="thinking" />);

    const avatar = screen.getByRole('img', { name: 'Sage is thinking' });
    expect(avatar).toHaveTextContent('🦊');
    expect(avatar).toHaveAttribute('data-state', 'thinking');
  });

  it('renders an image when the avatar is an asset path', () => {
    render(<PetAvatar pet={{ ...sage, avatar: 'https://example.test/sage.png' }} />);

    expect(screen.getByRole('img').querySelector('img')).toHaveAttribute(
      'src',
      'https://example.test/sage.png',
    );
  });

  it('gives each state its own ring so the state is visible at a glance', () => {
    const { rerender } = render(<PetAvatar pet={sage} state="idle" />);
    const idleRing = screen.getByRole('img').className;

    rerender(<PetAvatar pet={sage} state="speaking" />);
    const speakingRing = screen.getByRole('img').className;

    expect(speakingRing).not.toBe(idleRing);
    expect(screen.getByRole('img')).toHaveAttribute('data-state', 'speaking');
  });

  it('is idle unless told otherwise', () => {
    render(<PetAvatar pet={sage} />);

    expect(screen.getByRole('img')).toHaveAttribute('data-state', 'idle');
  });
});

describe('PetAvatar capture badge', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows no badge before anything has been captured', () => {
    render(<PetAvatar pet={sage} />);

    expect(screen.queryByTestId('capture-badge')).not.toBeInTheDocument();
  });

  it('shows the eye badge for one second on a capture', () => {
    const { rerender } = render(<PetAvatar pet={sage} captureCount={0} />);

    rerender(<PetAvatar pet={sage} captureCount={1} />);
    expect(screen.getByTestId('capture-badge')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(999));
    expect(screen.getByTestId('capture-badge')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('capture-badge')).not.toBeInTheDocument();
  });

  it('shows the badge again on every later capture', () => {
    const { rerender } = render(<PetAvatar pet={sage} captureCount={1} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId('capture-badge')).not.toBeInTheDocument();

    rerender(<PetAvatar pet={sage} captureCount={2} />);
    expect(screen.getByTestId('capture-badge')).toBeInTheDocument();
  });
});
