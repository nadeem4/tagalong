/**
 * Tests for ModelField: the disabled Provider, the Model listbox with its keyboard, the pick that
 * saves at once, and a refusal shown beside the field. Runs on the fake host bridge.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { ModelField } from './model-field';

async function setup() {
  const host = createFakeHostBridge();
  render(<ModelField host={host} />);
  const model = await screen.findByRole('combobox', { name: 'Model' });
  return { host, model };
}

describe('ModelField', () => {
  it('provider is disabled, shows Anthropic and More providers coming later, and Tab skips it', async () => {
    await setup();
    const provider = screen.getByRole('combobox', { name: 'Provider' });
    expect(provider).toHaveAttribute('aria-disabled', 'true');
    expect(provider).toHaveTextContent('Anthropic');
    expect(provider).not.toHaveAttribute('tabindex');
    expect(screen.getByText('More providers coming later')).toBeInTheDocument();
  });

  it('closed select shows the name and the line', async () => {
    const { model } = await setup();
    expect(model).toHaveTextContent('Claude Opus 5.5');
    expect(model).toHaveTextContent('Most capable');
    expect(model).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(
      screen.getByText(
        "Faster models cost less per reply, so your daily limit lasts longer. Applies from Scout's next reply.",
      ),
    ).toBeInTheDocument();
  });

  it('open list has three models, a check on the current one and Default on Opus', async () => {
    const { model } = await setup();
    fireEvent.click(model);
    const options = within(screen.getByRole('listbox', { name: 'Model' })).getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveTextContent('Default');
    expect(options[0]?.querySelector('svg')).not.toBeNull();
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).not.toHaveTextContent('Default');
    expect(options[1]).toHaveTextContent('Faster and cheaper');
    expect(options[2]).toHaveTextContent('Fastest, for simple tasks');
  });

  it('keyboard: Alt+Down opens, arrows move, Enter picks, Esc closes', async () => {
    const { host, model } = await setup();
    fireEvent.keyDown(model, { key: 'ArrowDown', altKey: true });
    expect(model).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(model, { key: 'Escape' });
    expect(model).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(model, { key: 'Enter' });
    fireEvent.keyDown(model, { key: 'ArrowDown' });
    fireEvent.keyDown(model, { key: 'ArrowDown' });
    fireEvent.keyDown(model, { key: 'ArrowUp' });
    fireEvent.keyDown(model, { key: 'Enter' });
    await waitFor(() => expect(host.modelsSet).toEqual(['claude-sonnet-5-5']));
    expect(model).toHaveAttribute('aria-expanded', 'false');
  });

  it('Space opens the list too', async () => {
    const { model } = await setup();
    fireEvent.keyDown(model, { key: ' ' });
    expect(model).toHaveAttribute('aria-expanded', 'true');
  });

  it('picking calls setModel and shows Saved.', async () => {
    const { host, model } = await setup();
    fireEvent.click(model);
    fireEvent.click(screen.getByRole('option', { name: /Claude Sonnet 5\.5/ }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(host.modelsSet).toEqual(['claude-sonnet-5-5']);
    expect(model).toHaveTextContent('Claude Sonnet 5.5');
    expect(model).toHaveTextContent('Faster and cheaper');
  });

  it('picking the current model saves nothing', async () => {
    const { host, model } = await setup();
    fireEvent.click(model);
    fireEvent.click(screen.getByRole('option', { name: /Claude Opus 5\.5/ }));
    expect(host.modelsSet).toEqual([]);
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('refusal shows an inline error and keeps the current model', async () => {
    const { host, model } = await setup();
    host.modelError = 'set_model needs one of the listed models.';
    fireEvent.click(model);
    fireEvent.click(screen.getByRole('option', { name: /Claude Haiku 5\.5/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'set_model needs one of the listed models.',
    );
    expect(screen.queryByText('Saved.')).toBeNull();
    expect(model).toHaveTextContent('Claude Opus 5.5');
  });

  it('shows nothing while the brain is away', async () => {
    const host = createFakeHostBridge();
    host.modelState = () => Promise.reject(new Error('brain offline'));
    render(<ModelField host={host} />);
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
  });
});
