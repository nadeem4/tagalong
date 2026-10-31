/** Tests for step 4: the ask key is shown and changed, saved only on Next, nothing on Skip. */

import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepFour } from './step-four';
import { makeWalkthroughHost, mountStep } from './test-host';

function mount(host = makeWalkthroughHost()) {
  const saver = mountStep(<StepFour host={host} />);
  return { host, saver };
}

describe('StepFour', () => {
  it('shows the current ask key as people read it, and Change', async () => {
    mount();
    expect(await screen.findByText('Ctrl+Shift+Space')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Shift+Alt+P')).toBeInTheDocument();
  });

  it('saves the changed ask key through saveSettings only when Next saves', async () => {
    const { host, saver } = mount();
    await screen.findByText('Ctrl+Shift+Space');
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
    await screen.findByText('Ctrl+Shift+Space');
    await saver.save();
    expect(host.saveSettings).not.toHaveBeenCalled();
  });

  it('lists the apps Scout never reads', async () => {
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
    expect(screen.getByText(/Home, under Settings > Privacy/)).toBeInTheDocument();
  });
});
