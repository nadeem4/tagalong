/**
 * Tests for VoiceField, the shared "Scout's voice" card: Auto then the roster, picking, the
 * sample play button and its failure note, the download state and the refresh on a tts change.
 * Fake host bridge.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { VoiceField } from './voice-field';

async function setup(change: (host: ReturnType<typeof createFakeHostBridge>) => void = () => {}) {
  const host = createFakeHostBridge();
  change(host);
  render(<VoiceField host={host} speed={1.1} />);
  await screen.findByText('Alan');
  return host;
}

describe('VoiceField', () => {
  it('renders Auto and the roster from tts_state', async () => {
    await setup();
    expect(screen.getByRole('heading', { name: "Scout's voice" })).toBeInTheDocument();
    expect(screen.getByText('Auto')).toBeInTheDocument();
    expect(screen.getByText('Runs on any PC')).toBeInTheDocument();
    expect(screen.getByText('Alan')).toBeInTheDocument();
    expect(screen.getByText('George')).toBeInTheDocument();
    expect(screen.getByText(/Right now: Alan/)).toBeInTheDocument();
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(
      screen.getByText('Press play to hear a voice before you download it.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Piper')).toBeInTheDocument();
  });

  it('picking a voice calls setTts and refreshes', async () => {
    const host = await setup();
    fireEvent.click(screen.getByRole('radio', { name: /George/ }));
    await waitFor(() => expect(host.ttsSets).toEqual(['kokoro-bm-george']));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /George/ })).toHaveAttribute('aria-checked', 'true'),
    );
  });

  it('play calls playVoiceSample with the voice and speed', async () => {
    const host = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Play George' }));
    await waitFor(() => expect(host.samplesPlayed).toEqual([['kokoro-bm-george', 1.1]]));
  });

  it('an uninstalled voice shows its size and a download state', async () => {
    await setup();
    const george = screen.getByRole('radio', { name: /George/ });
    expect(george).toHaveTextContent('92 MB');
    expect(george).toHaveTextContent('Download');
    // Auto resolves to Alan, so Alan is the voice in use.
    expect(screen.getByRole('radio', { name: /^Alan/ })).toHaveTextContent('In use');
  });

  it('an installed voice that is not in use says Downloaded', async () => {
    await setup((h) => {
      h.tts = { ...h.tts, voices: h.tts.voices.map((v) => ({ ...v, installed: true })) };
    });
    expect(screen.getByRole('radio', { name: /George/ })).toHaveTextContent('Downloaded');
  });

  it('the play button draws an icon, not a text glyph', async () => {
    await setup();
    const play = screen.getByRole('button', { name: 'Play George' });
    expect(play.querySelector('svg')).not.toBeNull();
    expect(play.textContent).toBe('');
  });

  it('shows Downloading n% on the voice being fetched', async () => {
    await setup((h) => {
      h.tts = {
        ...h.tts,
        chosen: 'kokoro-bm-george',
        download: { voice: 'kokoro-bm-george', status: 'downloading', progress: 0.4 },
      };
    });
    expect(screen.getByRole('radio', { name: /George/ })).toHaveTextContent('Downloading 40%');
  });

  it('no graphics-card group or chip is rendered', async () => {
    await setup();
    expect(document.body.textContent).not.toMatch(/graphics card|GPU/i);
  });

  it('a failed play shows a short note, not a crash', async () => {
    await setup((h) => {
      h.sampleError = 'no audio';
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play Alan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/play/i);
    expect(screen.getByText('Alan')).toBeInTheDocument();
  });

  it('shows a loading line until ttsState resolves', async () => {
    const host = createFakeHostBridge();
    let release: () => void = () => {};
    const real = host.ttsState;
    host.ttsState = () =>
      new Promise((resolve) => {
        release = () => resolve(real());
      });
    render(<VoiceField host={host} speed={1} />);
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
    await act(async () => {
      release();
    });
    expect(await screen.findByText('Alan')).toBeInTheDocument();
  });

  it("a 'tts' changed event refreshes", async () => {
    const host = await setup();
    host.tts = { ...host.tts, chosen: 'kokoro-bm-george' };
    act(() => host.emitChanged('tts'));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /George/ })).toHaveAttribute('aria-checked', 'true'),
    );
  });
});
