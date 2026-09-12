import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
