/**
 * Tests for step 9 (the key) and the finish card: Finish follows the key's state, the copy never
 * tells anyone to edit .env, and the pasted key is gone from the page once it is saved.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KeyResult, KeyStatus } from '../host-bridge';
import { FinishCard } from './finish-card';
import { StepNine } from './step-nine';
import { HAS_KEY, makeWalkthroughHost, NO_KEY } from './test-host';

const FAKE_KEY = 'sk-ant-example-not-a-real-key';

/** A host whose key facts a test can change and announce, like the brain does. */
function keyHost(start: KeyStatus | 'offline', result: KeyResult | Promise<KeyResult> = 'ok') {
  let status = start;
  const changed = new Set<(what: string) => void>();
  const host = makeWalkthroughHost();
  host.keyStatus.mockImplementation(() =>
    status === 'offline' ? Promise.reject(new Error('offline')) : Promise.resolve({ ...status }),
  );
  host.setKey.mockImplementation(async () => {
    const outcome = await result;
    if (outcome === 'ok') status = HAS_KEY;
    return outcome;
  });
  host.onBrainChanged.mockImplementation((handler: (what: string) => void) => {
    changed.add(handler);
    return () => void changed.delete(handler);
  });
  return {
    host,
    set: (next: KeyStatus | 'offline') => (status = next),
    emit: (what: string) => act(() => changed.forEach((handler) => handler(what))),
  };
}

function mount(start: KeyStatus | 'offline', result?: KeyResult | Promise<KeyResult>) {
  const fake = keyHost(start, result);
  const onValid = vi.fn();
  render(<StepNine host={fake.host} onValid={onValid} />);
  return { ...fake, onValid };
}

const lastValid = (onValid: ReturnType<typeof vi.fn>) => onValid.mock.calls.at(-1)?.[0];

async function paste() {
  fireEvent.change(await screen.findByLabelText('API key'), { target: { value: FAKE_KEY } });
}

describe('StepNine', () => {
  it('reports not valid until the key checks out, then valid', async () => {
    const { onValid } = mount(NO_KEY);
    await screen.findByText(/Saved on this computer in/);
    expect(lastValid(onValid)).toBe(false);
    await paste();
    fireEvent.click(screen.getByRole('button', { name: 'Check key' }));
    await waitFor(() => expect(lastValid(onValid)).toBe(true));
  });

  it('is valid when a key is already set', async () => {
    const { onValid } = mount(HAS_KEY);
    await screen.findByText('A key is already set.');
    expect(lastValid(onValid)).toBe(true);
  });

  it('is valid when the key comes from the environment', async () => {
    const { onValid } = mount({ ...HAS_KEY, source: 'environment' });
    await screen.findByText('Set by your environment');
    expect(lastValid(onValid)).toBe(true);
  });

  it('shows where the brain saves the key, and never says to edit .env', async () => {
    const { container } = render(<StepNine host={makeWalkthroughHost()} onValid={vi.fn()} />);
    expect(await screen.findByText('Saved on this computer in C:/home/.env')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\b(edit|open|add to|put .* in)\b[^.]*\.env/i);
    expect(screen.getByText(/keeps no copy/)).toBeInTheDocument();
    expect(screen.getByText(/daily limit of \$5/)).toBeInTheDocument();
  });

  it('invalid keeps the field and Finish stays off', async () => {
    const { onValid } = mount(NO_KEY, 'invalid');
    await paste();
    fireEvent.click(screen.getByRole('button', { name: 'Check key' }));
    await screen.findByText('That key was not accepted.');
    expect(screen.getByLabelText('API key')).toHaveValue(FAKE_KEY);
    expect(lastValid(onValid)).toBe(false);
  });

  it('unreachable offers Try again, never says invalid, and Finish stays off', async () => {
    const { onValid } = mount(NO_KEY, 'unreachable');
    await paste();
    fireEvent.click(screen.getByRole('button', { name: 'Check key' }));
    await screen.findByText('Scout could not reach Anthropic. Try again.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(screen.queryByText('That key was not accepted.')).not.toBeInTheDocument();
    expect(lastValid(onValid)).toBe(false);
  });

  it('offline says the brain is not running, then enables Check when it connects', async () => {
    const { set, emit, onValid } = mount('offline');
    await screen.findByText('Scout’s brain is not running.');
    await paste();
    expect(screen.getByRole('button', { name: 'Check key' })).toBeDisabled();
    expect(lastValid(onValid)).toBe(false);
    set(NO_KEY);
    await emit('link');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check key' })).toBeEnabled());
    expect(screen.queryByText('Scout’s brain is not running.')).not.toBeInTheDocument();
  });

  it('a brain that drops after the key was set turns Finish off and says so', async () => {
    const { set, emit, onValid } = mount(HAS_KEY);
    await screen.findByText('A key is already set.');
    expect(lastValid(onValid)).toBe(true);
    set('offline');
    await emit('link');
    await screen.findByText('Scout’s brain is not running.', {}, { timeout: 4000 });
    await waitFor(() => expect(lastValid(onValid)).toBe(false));
    expect(screen.queryByText('That key was not accepted.')).not.toBeInTheDocument();
  });

  it('a changed "key" event refreshes the state', async () => {
    const { set, emit, onValid } = mount(NO_KEY);
    await screen.findByText(/Saved on this computer in/);
    set(HAS_KEY);
    await emit('key');
    await screen.findByText('A key is already set.');
    expect(lastValid(onValid)).toBe(true);
  });

  it('a double press on Check sends one setKey', async () => {
    let release: (value: KeyResult) => void = () => undefined;
    const pending = new Promise<KeyResult>((resolve) => (release = resolve));
    const { host } = mount(NO_KEY, pending);
    await paste();
    const check = screen.getByRole('button', { name: 'Check key' });
    fireEvent.click(check);
    fireEvent.click(check);
    expect(host.setKey).toHaveBeenCalledTimes(1);
    await act(async () => release('ok'));
  });

  it('the pasted key is not in the page once it is saved', async () => {
    mount(NO_KEY);
    await paste();
    fireEvent.click(screen.getByRole('button', { name: 'Check key' }));
    await screen.findByText('A key is already set.');
    expect(screen.getByLabelText('API key')).toHaveValue('');
    expect(document.body.innerHTML).not.toContain(FAKE_KEY);
  });
});

describe('FinishCard', () => {
  const props = {
    askKey: 'Ctrl+Shift+Space',
    talkKey: 'Right Ctrl',
    onOpenHome: vi.fn(),
    onClose: vi.fn(),
  };

  it('shows the ask and talk keys, Open Home and Close', () => {
    render(<FinishCard {...props} />);
    expect(screen.getByRole('heading', { name: 'Scout is on your screen' })).toBeVisible();
    expect(screen.getByText('Ctrl+Shift+Space')).toBeInTheDocument();
    expect(screen.getByText('Right Ctrl')).toBeInTheDocument();
    expect(screen.getByText(/Look for Scout at the bottom right/)).toBeInTheDocument();
    expect(screen.getByText(/what Scout remembers are in Home/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Home' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
  });

  it('Close and Open Home call their handlers', () => {
    const onClose = vi.fn();
    const onOpenHome = vi.fn();
    render(<FinishCard {...props} onClose={onClose} onOpenHome={onOpenHome} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenHome).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
