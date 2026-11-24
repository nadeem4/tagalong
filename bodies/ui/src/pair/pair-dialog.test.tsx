/** Tests for PairDialog: the QR, link and expiry of a fresh code, copying, a new code, and a failure. */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFER } from '../walkthrough/test-host';
import { PairDialog } from './pair-dialog';

function open(overrides: Partial<Parameters<typeof PairDialog>[0]> = {}) {
  const props = {
    make: vi.fn(() => Promise.resolve(OFFER)),
    copyText: vi.fn((_text: string) => Promise.resolve()),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<PairDialog {...props} />);
  return props;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-11-23T12:00:19.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('PairDialog', () => {
  it('shows the QR, the link and how long the code has left', async () => {
    open();
    expect(await screen.findByRole('img', { name: 'Pairing QR code' })).toBeInTheDocument();
    expect(screen.getByText(OFFER.link)).toBeInTheDocument();
    expect(screen.getByText('Expires in 9:41')).toBeInTheDocument();
    await act(async () => {});
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByText('Expires in 9:40')).toBeInTheDocument();
  });

  it('asks for one code, not another each second', async () => {
    const { make } = open();
    await screen.findByRole('img', { name: 'Pairing QR code' });
    act(() => void vi.advanceTimersByTime(5000));
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('copies the whole link', async () => {
    const { copyText } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
    expect(copyText).toHaveBeenCalledWith(OFFER.link);
  });

  it('makes a new code on request, and says so when the old one ran out', async () => {
    const { make } = open();
    await screen.findByRole('img', { name: 'Pairing QR code' });
    act(() => void vi.advanceTimersByTime(10 * 60 * 1000));
    expect(screen.getByText('This code has expired.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Make a new code' }));
    await waitFor(() => expect(make).toHaveBeenCalledTimes(2));
  });

  it('says so when the brain cannot make a code, and Done closes the dialog', async () => {
    const { onClose } = open({ make: vi.fn(() => Promise.reject(new Error('offline'))) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Scout could not make a code');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
