/** Tests for CopyButton: it copies its text, and a refused copy does not throw. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CopyButton } from './copy-button';

describe('CopyButton', () => {
  it('copies its text when pressed', () => {
    const copy = vi.fn((_text: string) => Promise.resolve());
    render(<CopyButton text="tagalong key set" copy={copy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copy).toHaveBeenCalledWith('tagalong key set');
  });

  it('swallows a copy the host refuses', async () => {
    const copy = vi.fn((_text: string) => Promise.reject(new Error('denied')));
    render(<CopyButton text="x" copy={copy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await Promise.resolve();
    expect(copy).toHaveBeenCalledTimes(1);
  });
});
