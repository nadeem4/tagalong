/**
 * Tests for VoiceDownloadLine: the one status line under the Voice select while Scout's voice
 * downloads, its thin bar, the retry line on a failure and nothing once it is ready. Fake host.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { VoiceDownloadLine } from './voice-download-line';

describe('VoiceDownloadLine', () => {
  it('shows the percent and the system-voice note while downloading', async () => {
    const host = createFakeHostBridge();
    host.voiceDownloadState = { status: 'downloading', progress: 0.42 };
    render(<VoiceDownloadLine host={host} />);
    expect(
      await screen.findByText(
        "Downloading Scout's voice… 42%. Using the computer's voice until then.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
  });

  it('follows the brain as the download moves, and goes away when ready', async () => {
    const host = createFakeHostBridge();
    host.voiceDownloadState = { status: 'downloading', progress: 0.1 };
    render(<VoiceDownloadLine host={host} />);
    await screen.findByText(/10%/);
    host.voiceDownloadState = { status: 'downloading', progress: 0.8 };
    act(() => host.emitChanged('voice_download'));
    await screen.findByText(/80%/);
    host.voiceDownloadState = { status: 'ready', progress: 1 };
    act(() => host.emitChanged('voice_download'));
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
    expect(screen.queryByText(/Downloading/)).toBeNull();
  });

  it('shows nothing when the brain cannot be asked', async () => {
    const host = createFakeHostBridge();
    host.voiceDownloadState = null;
    const { container } = render(<VoiceDownloadLine host={host} />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it('a failure says so plainly and the retry button asks the brain again', async () => {
    const host = createFakeHostBridge();
    host.voiceDownloadState = { status: 'failed', progress: 0 };
    render(<VoiceDownloadLine host={host} />);
    expect(
      await screen.findByText(
        /^Couldn.t download Scout.s voice\. The computer.s voice is speaking for now\./,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(host.voiceFetches).toEqual([true]);
  });
});
