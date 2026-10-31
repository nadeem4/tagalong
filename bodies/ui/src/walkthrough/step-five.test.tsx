/** Tests for step 5: talk key, Scout talks, voice, speed and preview; saved only on Next. */

import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepFive } from './step-five';
import { makeWalkthroughHost, mountStep } from './test-host';

function mount(host = makeWalkthroughHost()) {
  const saver = mountStep(<StepFive host={host} />);
  return { host, saver };
}

describe('StepFive', () => {
  it('offers no Always listening control', async () => {
    mount();
    await screen.findByLabelText('Talk key');
    expect(screen.queryByText(/always listening/i)).not.toBeInTheDocument();
  });

  it('talk key choices are exactly Right Ctrl, Right Alt, Right Shift, Scroll Lock', async () => {
    mount();
    const select = await screen.findByLabelText('Talk key');
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['Right Ctrl', 'Right Alt', 'Right Shift', 'Scroll Lock']);
  });

  it('saves Scout talks, voice, speed and talk key on Next, keeping the rest of each object', async () => {
    const { host, saver } = mount();
    const talkKey = await screen.findByLabelText('Talk key');
    fireEvent.change(talkKey, { target: { value: 'ScrollLock' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Scout talks' }));
    fireEvent.change(screen.getByLabelText('Voice'), { target: { value: 'bm_fable' } });
    fireEvent.change(screen.getByLabelText(/^Speed/), { target: { value: '1.1' } });
    expect(host.saveSettings).not.toHaveBeenCalled();
    await saver.save();
    expect(host.saveSettings).toHaveBeenCalledWith({
      hotkeys: {
        ask: 'CommandOrControl+Shift+Space',
        pauseSight: 'CommandOrControl+Shift+Alt+P',
        talk: 'ScrollLock',
      },
      voice: { enabled: false, voice: 'bm_fable', speed: 1.1 },
    });
  });

  it('Preview plays the chosen voice at the chosen speed through the existing preview', async () => {
    const { host } = mount();
    await screen.findByLabelText('Talk key');
    fireEvent.change(screen.getByLabelText('Voice'), { target: { value: 'bm_fable' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
    expect(host.previewVoice).toHaveBeenCalledWith(
      expect.objectContaining({ voice: 'bm_fable', speed: 0.95, mouth: 'kokoro' }),
    );
  });

  it('saves the microphone picked and leaves System default as no id', async () => {
    const { host, saver } = mount();
    await screen.findByLabelText('Microphone');
    await screen.findByRole('option', { name: 'Desk microphone' });
    fireEvent.change(screen.getByLabelText('Microphone'), { target: { value: 'mic-1' } });
    await saver.save();
    expect(host.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        voice: expect.objectContaining({ microphoneId: 'mic-1' }),
      }),
    );
  });

  it('mentions the 92 MB voice download and the 43 MB listening models', async () => {
    mount();
    await screen.findByLabelText('Talk key');
    expect(screen.getByText(/about 92 MB/)).toBeInTheDocument();
    expect(screen.getByText(/about 43 MB/)).toBeInTheDocument();
  });

  it('saves nothing when nothing was changed', async () => {
    const { host, saver } = mount();
    await screen.findByLabelText('Talk key');
    await saver.save();
    expect(host.saveSettings).not.toHaveBeenCalled();
  });
});
