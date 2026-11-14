/**
 * Tests for VoiceModelsField: the Speech to text card's header chip, the two selects with Auto
 * first, the pick that saves at once and a refusal shown beside the field. Fake host bridge.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { VoiceModelsField } from './voice-models-field';

async function setup(change: (host: ReturnType<typeof createFakeHostBridge>) => void = () => {}) {
  const host = createFakeHostBridge();
  change(host);
  render(
    <VoiceModelsField
      host={host}
      liveInfo={<span>live-info</span>}
      finalInfo={<span>final-info</span>}
    >
      <p>footer</p>
    </VoiceModelsField>,
  );
  const live = (await screen.findByLabelText('While you talk')) as HTMLSelectElement;
  const final = screen.getByLabelText('When you finish') as HTMLSelectElement;
  return { host, live, final };
}

const labels = (select: HTMLSelectElement) => [...select.options].map((o) => o.textContent);

describe('VoiceModelsField', () => {
  it('has its title, lead line, the footer and both info slots', async () => {
    await setup();
    expect(screen.getByRole('heading', { name: 'Speech to text' })).toBeInTheDocument();
    expect(screen.getByText("How Scout's brain writes down what you say.")).toBeInTheDocument();
    expect(screen.getByText('footer')).toBeInTheDocument();
    expect(screen.getByText('live-info')).toBeInTheDocument();
    expect(screen.getByText('final-info')).toBeInTheDocument();
  });

  it('shows Auto first, as just the word Auto', async () => {
    const { live, final } = await setup();
    expect(live.value).toBe('auto');
    expect(final.value).toBe('auto');
    expect(labels(live)).toEqual(['Auto', 'Moonshine tiny · 45 MB', 'Moonshine small · 120 MB']);
    expect(document.body.textContent).not.toContain('now:');
  });

  it('the final select can switch the second look off', async () => {
    const { final } = await setup();
    expect(labels(final)).toEqual([
      'Auto',
      "Don't double-check",
      'Whisper small (English) · 462 MB',
      'Whisper large v3 turbo · 1.5 GB',
    ]);
  });

  it('shows the graphics card with a dot, or No graphics card', async () => {
    await setup();
    expect(screen.getByText('NVIDIA GeForce RTX 4060')).toBeInTheDocument();
  });

  it('says No graphics card when the brain sees none', async () => {
    await setup((host) => {
      host.stt = { ...host.stt, gpu_name: null };
    });
    expect(screen.getByText('No graphics card')).toBeInTheDocument();
  });

  it('marks a model that needs a graphics card when there is none', async () => {
    const { final } = await setup((host) => {
      host.stt = {
        ...host.stt,
        gpu_name: null,
        models: host.stt.models.map((m) =>
          m.id === 'whisper-large-v3-turbo' ? { ...m, gpu: 'required' as const } : m,
        ),
      };
    });
    const large = [...final.options].find((o) => o.value === 'whisper-large-v3-turbo');
    expect(large?.textContent).toContain('Needs a graphics card');
    expect(large?.disabled).toBe(true);
  });

  it('choosing a model calls setStt once and shows it saved', async () => {
    const { host, live } = await setup();
    fireEvent.change(live, { target: { value: 'moonshine-tiny' } });
    await waitFor(() => expect(host.sttSets).toEqual([{ live: 'moonshine-tiny' }]));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(live.value).toBe('moonshine-tiny');
  });

  it('choosing no second look sends off', async () => {
    const { host, final } = await setup();
    fireEvent.change(final, { target: { value: 'off' } });
    await waitFor(() => expect(host.sttSets).toEqual([{ final: 'off' }]));
  });

  it('a failed set shows the error and keeps the old value', async () => {
    const { live } = await setup((host) => {
      host.sttError = 'Not a listed model.';
    });
    fireEvent.change(live, { target: { value: 'moonshine-tiny' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a listed model.');
    expect(live.value).toBe('auto');
  });
});
