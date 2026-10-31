/** Tests for KeyField and LimitField: every state, one check at a time, the key never left in the DOM. */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KeyResult, KeyStatus } from '../host-bridge';
import { KeyField, LimitField } from './key-field';

const FAKE_KEY = 'sk-ant-example-not-a-real-key';

const STATUS: KeyStatus = {
  hasKey: false,
  source: 'none',
  envPath: 'C:/home/.env',
  dailyLimitUsd: 5,
};

function makeHost(
  options: {
    status?: KeyStatus | 'offline';
    result?: KeyResult | Promise<KeyResult>;
  } = {},
) {
  let status = options.status ?? STATUS;
  const changed = new Set<(what: string) => void>();
  const setKey = vi.fn((_key: string) => Promise.resolve(options.result ?? 'ok'));
  return {
    setKey,
    keyStatus: vi.fn(() =>
      status === 'offline'
        ? Promise.reject(new Error('brain offline'))
        : Promise.resolve({ ...status }),
    ),
    onBrainChanged: (handler: (what: string) => void) => {
      changed.add(handler);
      return () => void changed.delete(handler);
    },
    setStatus: (next: KeyStatus | 'offline') => (status = next),
    emit: (what: string) => changed.forEach((handler) => handler(what)),
  };
}

async function paste(value: string) {
  const field = await screen.findByLabelText('API key');
  fireEvent.change(field, { target: { value } });
  return field;
}

describe('KeyField', () => {
  it('ok clears the field at once and calls onSaved', async () => {
    const host = makeHost({ result: 'ok' });
    const onSaved = vi.fn();
    render(<KeyField host={host} onSaved={onSaved} />);
    const field = await paste(FAKE_KEY);
    host.setStatus({ ...STATUS, hasKey: true, source: 'file' });
    fireEvent.click(screen.getByRole('button', { name: 'Check key' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(host.setKey).toHaveBeenCalledWith(FAKE_KEY);
    expect(field).toHaveValue('');
    expect(await screen.findByText('A key is already set.')).toBeInTheDocument();
  });

  it('invalid keeps the field and says not accepted', async () => {
    const host = makeHost({ result: 'invalid' });
    render(<KeyField host={host} />);
    const field = await paste(FAKE_KEY);
    fireEvent.click(screen.getByRole('button', { name: 'Check key' }));
    expect(await screen.findByText('That key was not accepted.')).toBeInTheDocument();
    expect(field).toHaveValue(FAKE_KEY);
  });

  it('unreachable offers Try again and keeps the field', async () => {
    const host = makeHost({ result: 'unreachable' });
    render(<KeyField host={host} />);
    const field = await paste(FAKE_KEY);
    fireEvent.click(screen.getByRole('button', { name: 'Check key' }));
    expect(
      await screen.findByText('Scout could not reach Anthropic. Try again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(field).toHaveValue(FAKE_KEY);
  });

  it('offline disables Check', async () => {
    const host = makeHost({ status: 'offline' });
    render(<KeyField host={host} />);
    await paste(FAKE_KEY);
    expect(await screen.findByText('Scout’s brain is not running.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check key' })).toBeDisabled();
  });

  it('a brain that drops during the check reads as offline, never invalid', async () => {
    const host = makeHost({ result: 'offline' });
    render(<KeyField host={host} />);
    await paste(FAKE_KEY);
    fireEvent.click(screen.getByRole('button', { name: 'Check key' }));
    expect(await screen.findByText('Scout’s brain is not running.')).toBeInTheDocument();
    expect(screen.queryByText('That key was not accepted.')).not.toBeInTheDocument();
  });

  it('after an offline result, a fresh status lets Check work again', async () => {
    const host = makeHost({ result: 'offline' });
    render(<KeyField host={host} />);
    await paste(FAKE_KEY);
    fireEvent.click(screen.getByRole('button', { name: 'Check key' }));
    expect(await screen.findByText('Scout’s brain is not running.')).toBeInTheDocument();
    act(() => host.emit('link'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check key' })).toBeEnabled());
    expect(screen.queryByText('Scout’s brain is not running.')).not.toBeInTheDocument();
  });

  it('a second press while checking is ignored (setKey called once)', async () => {
    let finish: (result: KeyResult) => void = () => undefined;
    const host = makeHost({
      result: new Promise<KeyResult>((resolve) => {
        finish = resolve;
      }),
    });
    render(<KeyField host={host} />);
    await paste(FAKE_KEY);
    const check = screen.getByRole('button', { name: 'Check key' });
    fireEvent.click(check);
    fireEvent.click(check);
    fireEvent.keyDown(screen.getByLabelText('API key'), { key: 'Enter' });
    expect(host.setKey).toHaveBeenCalledTimes(1);
    await act(async () => finish('invalid'));
  });

  it('a key with only spaces is not sent', async () => {
    const host = makeHost();
    render(<KeyField host={host} />);
    await paste('   ');
    expect(screen.getByRole('button', { name: 'Check key' })).toBeDisabled();
  });

  it('environment source disables the field and reads Set by your environment', async () => {
    const host = makeHost({ status: { ...STATUS, hasKey: true, source: 'environment' } });
    render(<KeyField host={host} />);
    expect(await screen.findByText('Set by your environment')).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Check key' })).toBeDisabled();
  });

  it('already set shows the already-set line and still allows a change', async () => {
    const host = makeHost({ status: { ...STATUS, hasKey: true, source: 'file' } });
    render(<KeyField host={host} />);
    expect(await screen.findByText('A key is already set.')).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toBeEnabled();
  });

  it('refreshes when the brain says the key changed', async () => {
    const host = makeHost();
    render(<KeyField host={host} />);
    await screen.findByLabelText('API key');
    host.setStatus({ ...STATUS, hasKey: true, source: 'file' });
    act(() => host.emit('key'));
    expect(await screen.findByText('A key is already set.')).toBeInTheDocument();
  });

  it('Show reveals the field and hides it again', async () => {
    const host = makeHost();
    render(<KeyField host={host} />);
    const field = await paste(FAKE_KEY);
    expect(field).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(field).toHaveAttribute('type', 'text');
  });

  it('the pasted value is never rendered into the DOM after ok', async () => {
    const host = makeHost({ result: 'ok' });
    const { container } = render(<KeyField host={host} />);
    await paste(FAKE_KEY);
    fireEvent.click(screen.getByRole('button', { name: 'Check key' }));
    await waitFor(() => expect(host.setKey).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('API key')).toHaveValue(''));
    expect(container.innerHTML).not.toContain(FAKE_KEY);
  });

  it('a rejected call shows the brain’s plain line, never the key', async () => {
    const host = makeHost();
    host.setKey.mockRejectedValueOnce(new Error('Scout could not save the key.'));
    render(<KeyField host={host} />);
    await paste(FAKE_KEY);
    fireEvent.click(screen.getByRole('button', { name: 'Check key' }));
    expect(await screen.findByText('Scout could not save the key.')).toBeInTheDocument();
  });

  it('strips Electron’s wrapper from a rejected call', async () => {
    const host = makeHost();
    host.setKey.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'tagalong:key:set': Error: Scout could not save the key.",
      ),
    );
    render(<KeyField host={host} />);
    await paste(FAKE_KEY);
    fireEvent.click(screen.getByRole('button', { name: 'Check key' }));
    expect(await screen.findByText('Scout could not save the key.')).toBeInTheDocument();
  });
});

describe('LimitField', () => {
  it('rejects 0, negative and empty', () => {
    const setDailyLimit = vi.fn(() => Promise.resolve());
    render(<LimitField host={{ setDailyLimit }} limitUsd={5} />);
    const field = screen.getByLabelText('Daily limit (USD)');
    for (const bad of ['0', '-3', '', 'abc']) {
      fireEvent.change(field, { target: { value: bad } });
      fireEvent.click(screen.getByRole('button', { name: 'Set limit' }));
    }
    expect(setDailyLimit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an amount above $0.');
  });

  it('strips Electron’s wrapper from a rejected limit', async () => {
    const setDailyLimit = vi.fn(() =>
      Promise.reject(
        new Error(
          "Error invoking remote method 'tagalong:limit:set': Error: Enter an amount above $0.",
        ),
      ),
    );
    render(<LimitField host={{ setDailyLimit }} limitUsd={5} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set limit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Enter an amount above \$0\.$/);
  });

  it('saves a valid amount', async () => {
    const setDailyLimit = vi.fn((_usd: number) => Promise.resolve());
    render(<LimitField host={{ setDailyLimit }} limitUsd={5} />);
    fireEvent.change(screen.getByLabelText('Daily limit (USD)'), { target: { value: '7.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set limit' }));
    await waitFor(() => expect(setDailyLimit).toHaveBeenCalledWith(7.5));
    expect(await screen.findByText('Daily limit saved.')).toBeInTheDocument();
  });

  it('follows the limit the brain reports', () => {
    const host = { setDailyLimit: () => Promise.resolve() };
    const { rerender } = render(<LimitField host={host} limitUsd={5} />);
    rerender(<LimitField host={host} limitUsd={8} />);
    expect(screen.getByLabelText('Daily limit (USD)')).toHaveValue(8);
  });
});
