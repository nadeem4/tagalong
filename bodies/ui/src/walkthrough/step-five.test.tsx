/** Tests for step 5: talk key, Scout talks, voice, speed and preview; saved only on Next. */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StepFive } from './step-five';
import { StepSaveContext } from './use-step-save';
import { makeWalkthroughHost, mountStep } from './test-host';

function mount(host = makeWalkthroughHost()) {
  const saver = mountStep(<StepFive host={host} />);
  return { host, saver };
}

describe('StepFive', () => {
  it('Scout talks is a switch with aria-checked and no native checkbox remains', async () => {
    mount();
    const container = document.body;
    const toggle = await screen.findByRole('switch', { name: 'Scout talks' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('talk key, who speaks, voice and microphone are Selects with the label above', async () => {
    mount();
    const container = document.body;
    await screen.findByLabelText('Talk key');
    expect(container.querySelectorAll('.tg-select')).toHaveLength(4);
    for (const label of ['Talk key', 'Who speaks', 'Voice', 'Microphone']) {
      expect(screen.getByLabelText(label).closest('.tg-select')).not.toBeNull();
    }
  });

  it('the speed slider is a step 0.05 slider and shows its changed value', async () => {
    mount();
    const speed = await screen.findByLabelText(/^Speed/);
    expect(speed.closest('.tg-slider')).not.toBeNull();
    expect(speed).toHaveAttribute('step', '0.05');
    fireEvent.change(speed, { target: { value: '1' } });
    expect(screen.getByText('1.00x')).toBeInTheDocument();
  });

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

  it('Preview is a secondary button beside the voice select', async () => {
    mountStep(<StepFive host={makeWalkthroughHost()} />);
    const preview = await screen.findByRole('button', { name: /Preview/ });
    expect(preview).toHaveClass('tg-button--secondary');
    expect(preview.parentElement).toContainElement(screen.getByLabelText('Voice'));
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

  it('mentions the 92 MB voice download and the 120 MB listening models', async () => {
    mount();
    await screen.findByLabelText('Talk key');
    expect(screen.getByText(/about 92 MB/)).toBeInTheDocument();
    expect(screen.getByText(/about 120 MB/)).toBeInTheDocument();
  });

  it('saves nothing when nothing was changed', async () => {
    const { host, saver } = mount();
    await screen.findByLabelText('Talk key');
    await saver.save();
    expect(host.saveSettings).not.toHaveBeenCalled();
  });

  it('shows the spec copy word for word', async () => {
    mount();
    await screen.findByLabelText('Talk key');
    expect(
      screen.getByRole('heading', { name: 'Talk to Scout, and hear it back' }),
    ).toBeInTheDocument();
    for (const text of [
      'Hold the talk key, ask out loud, let go. Scout answers in short spoken sentences, and the words show in the bubble too.',
      'Reads answers aloud, so you can look away.',
      'Made on your computer. The voice downloads the first time Scout speaks (about 92 MB); until then Scout uses the Windows voice.',
      'Your voice is turned into text by your own brain and is never stored. With the brain on this computer, it never leaves it. The listening models download the first time you talk (about 120 MB, and about 1.5 GB more on a PC with a graphics card).',
      '(hold it on its own)',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    const voices = within(screen.getByLabelText('Voice'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(voices).toEqual(['George, Calm and measured', 'Fable, Warmer, a storyteller']);
    const speakers = within(screen.getByLabelText('Who speaks'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(speakers).toEqual(['Kokoro (on the brain)', 'System voice']);
    expect(screen.queryByText(/Try it/)).not.toBeInTheDocument();
  });

  describe('microphone test', () => {
    const press = () =>
      fireEvent.click(screen.getByRole('button', { name: 'Test your microphone' }));

    it('keeps the meter off until Test your microphone is pressed', async () => {
      const { host } = mount();
      await screen.findByLabelText('Talk key');
      expect(screen.queryByRole('meter')).toBeNull();
      expect(host.watchMicLevel).not.toHaveBeenCalled();
      expect(
        screen.getByText('Nothing is recorded or sent. Speak and the bar moves.'),
      ).toBeInTheDocument();
    });

    it('watches the picked device when pressed', async () => {
      const { host } = mount();
      await screen.findByRole('option', { name: 'Desk microphone' });
      fireEvent.change(screen.getByLabelText('Microphone'), { target: { value: 'mic-1' } });
      press();
      expect(host.watchMicLevel).toHaveBeenCalledWith(
        'mic-1',
        expect.any(Function),
        expect.any(Function),
      );
      expect(screen.getByRole('meter')).toBeInTheDocument();
    });

    it('watches the system default with no device id', async () => {
      const { host } = mount();
      await screen.findByLabelText('Microphone');
      press();
      expect(host.watchMicLevel).toHaveBeenCalledWith(
        undefined,
        expect.any(Function),
        expect.any(Function),
      );
    });

    it('restarts the watch with the new id when the microphone changes', async () => {
      const { host } = mount();
      await screen.findByRole('option', { name: 'Desk microphone' });
      press();
      fireEvent.change(screen.getByLabelText('Microphone'), { target: { value: 'mic-1' } });
      expect(host.watchMicLevel).toHaveBeenCalledTimes(2);
      expect(host.watchMicLevel).toHaveBeenLastCalledWith(
        'mic-1',
        expect.any(Function),
        expect.any(Function),
      );
    });

    it('stops the watch when the step is left', async () => {
      const stop = vi.fn();
      const host = makeWalkthroughHost();
      host.watchMicLevel.mockReturnValue({ stop });
      const { unmount } = render(
        <StepSaveContext.Provider value={() => undefined}>
          <StepFive host={host} />
        </StepSaveContext.Provider>,
      );
      await screen.findByLabelText('Talk key');
      press();
      unmount();
      expect(stop).toHaveBeenCalledTimes(1);
    });

    it('shows the mic failure line and no meter when permission is denied', async () => {
      const host = makeWalkthroughHost();
      host.watchMicLevel.mockImplementation((_id, _level, onError) => {
        onError('denied');
        return { stop: vi.fn() };
      });
      mount(host);
      await screen.findByLabelText('Talk key');
      act(() => press());
      expect(screen.getByRole('alert')).toHaveTextContent('not allowed to use the microphone');
      expect(screen.queryByRole('meter')).toBeNull();
    });

    it('only the level reaches the host: no host method is given any sound', async () => {
      const host = makeWalkthroughHost();
      // The fake listens like the real one: it reads a real audio frame, then reports a number.
      host.watchMicLevel.mockImplementation((_id, onLevel) => {
        const frame = new Float32Array([0.5, -0.5, 0.25]);
        onLevel(Math.max(...frame));
        return { stop: vi.fn() };
      });
      mount(host);
      await screen.findByLabelText('Talk key');
      act(() => press());
      const sound = (value: unknown): boolean =>
        value instanceof Float32Array ||
        value instanceof ArrayBuffer ||
        (typeof MediaStream !== 'undefined' && value instanceof MediaStream);
      for (const [name, fn] of Object.entries(host)) {
        if (name === 'watchMicLevel') continue;
        const calls = (fn as { mock: { calls: unknown[][] } }).mock.calls;
        for (const args of calls) expect(args.some(sound), name).toBe(false);
      }
      expect(host.saveSettings).not.toHaveBeenCalled();
    });
  });

  it('says so when the preview cannot play', async () => {
    const host = makeWalkthroughHost();
    host.previewVoice.mockRejectedValueOnce(new Error('no audio'));
    mount(host);
    await screen.findByLabelText('Talk key');
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
    expect(await screen.findByText('The preview could not play.')).toBeInTheDocument();
    await waitFor(() => expect(host.previewVoice).toHaveBeenCalledTimes(1));
  });
});
