/** Tests for step 4: the keys drawn as keycaps, the ask key changed and saved only on Next, the static preview. */

import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepFour } from './step-four';
import { makeWalkthroughHost, mountStep } from './test-host';

const keys = (group: HTMLElement) =>
  within(group)
    .getAllByText(/.+/, { selector: 'kbd' })
    .map((key) => key.textContent);

function mount(host = makeWalkthroughHost()) {
  const saver = mountStep(<StepFour host={host} />);
  return { host, saver };
}

describe('StepFour', () => {
  it('shows the ask key and the pause key as keycaps, never CommandOrControl', async () => {
    mount();
    const ask = await screen.findByTestId('wt-ask-key');
    expect(keys(ask)).toEqual(['Ctrl', 'Shift', 'Space']);
    expect(keys(screen.getByTestId('wt-pause-key'))).toEqual(['Ctrl', 'Shift', 'Alt', 'P']);
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('CommandOrControl');
  });

  it('saves the changed ask key through saveSettings only when Next saves', async () => {
    const { host, saver } = mount();
    await screen.findByRole('button', { name: 'Change' });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Ask key'), { target: { value: 'Alt+Space' } });
    expect(host.saveSettings).not.toHaveBeenCalled();
    await saver.save();
    // The whole hotkeys object goes, as Settings sends it: a patch replaces it.
    expect(host.saveSettings).toHaveBeenCalledWith({
      hotkeys: {
        ask: 'Alt+Space',
        pauseSight: 'CommandOrControl+Shift+Alt+P',
      },
    });
  });

  it('saves nothing when the ask key was left alone', async () => {
    const { host, saver } = mount();
    await screen.findByRole('button', { name: 'Change' });
    await saver.save();
    expect(host.saveSettings).not.toHaveBeenCalled();
  });

  it('lists what Scout never looks at', async () => {
    mount();
    for (const text of [
      'Password managers',
      'Windows sign-in prompts',
      '.env and SSH keys',
      'Private browsing',
      'Authenticator apps',
      'Remote Desktop',
    ]) {
      expect(await screen.findByText(text, { exact: false })).toBeInTheDocument();
    }
    expect(screen.getByText('Scout never looks at')).toBeInTheDocument();
    expect(screen.getByText(/Home, under Settings > Privacy/)).toBeInTheDocument();
  });

  it('shows a static bubble preview that assistive tech skips', async () => {
    mount();
    await screen.findByRole('button', { name: 'Change' });
    const preview = screen.getByTestId('wt-bubble-preview');
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    for (const text of [
      'Chrome · Acme pricing',
      'Which plan fits a team of five?',
      'Open full chat',
    ]) {
      expect(within(preview).getByText(text)).toBeInTheDocument();
    }
    expect(within(preview).queryByRole('button')).not.toBeInTheDocument();
  });
});
