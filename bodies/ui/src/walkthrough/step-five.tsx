/**
 * Walkthrough step 5: talking to Scout. Talk key, Scout talks, who speaks, voice, speed and
 * microphone (with a local level test), all staged here and saved only on Next. Contains
 * StepFive. Words are the spec's step copy; the choices match Settings.
 */

import { useEffect, useState } from 'react';
import { Button, MicTest, Select, Slider, Toggle } from '../controls';
import { useStepSave, useWalkthroughSettings } from './use-step-save';
import type { WalkthroughHost, WalkthroughSettings } from './walkthrough-host';

// The same four keys Settings offers; the host refuses anything else.
export const TALK_KEYS: readonly { value: string; label: string }[] = [
  { value: 'RightControl', label: 'Right Ctrl' },
  { value: 'RightAlt', label: 'Right Alt' },
  { value: 'RightShift', label: 'Right Shift' },
  { value: 'ScrollLock', label: 'Scroll Lock' },
];

const VOICES: readonly { value: string; label: string }[] = [
  { value: 'bm_george', label: 'George, Calm and measured' },
  { value: 'bm_fable', label: 'Fable, Warmer, a storyteller' },
];

const SAMPLE = 'Hi, I’m Scout. This is how I sound.';

function VoiceForm({ host, settings }: { host: WalkthroughHost; settings: WalkthroughSettings }) {
  const start = settings.voice;
  const startTalk = settings.hotkeys.talk ?? 'RightControl';
  const startMouth = start.mouth === 'system' ? 'system' : 'kokoro';
  const [talk, setTalk] = useState(startTalk);
  const [enabled, setEnabled] = useState(start.enabled);
  const [mouth, setMouth] = useState<'kokoro' | 'system'>(startMouth);
  const [voice, setVoice] = useState(start.voice);
  const [speed, setSpeed] = useState(start.speed);
  const [mic, setMic] = useState(start.microphoneId ?? '');
  const [previewFailed, setPreviewFailed] = useState(false);
  const [mics, setMics] = useState<{ id: string; label: string }[]>([]);

  const { listMicrophones } = host;
  useEffect(() => {
    listMicrophones().then(setMics, () => setMics([]));
  }, [listMicrophones]);

  useStepSave(async () => {
    const patch: Partial<WalkthroughSettings> = {};
    if (talk !== startTalk) patch.hotkeys = { ...settings.hotkeys, talk };
    const micChanged = mic !== (start.microphoneId ?? '');
    if (
      enabled !== start.enabled ||
      voice !== start.voice ||
      speed !== start.speed ||
      mouth !== startMouth ||
      micChanged
    ) {
      // A patch replaces the whole voice object, so the untouched fields go with it.
      const next = { ...start, enabled, voice, speed };
      if (mouth !== startMouth) next.mouth = mouth;
      if (micChanged) {
        if (mic === '') delete next.microphoneId;
        else next.microphoneId = mic;
      }
      patch.voice = next;
    }
    if (patch.hotkeys !== undefined || patch.voice !== undefined) await host.saveSettings(patch);
  });

  const micOptions = [
    { value: '', label: 'System default' },
    ...mics.map((m) => ({ value: m.id, label: m.label })),
  ];

  return (
    <div className="wt-form">
      <div>
        <Select
          id="wt-talk"
          label="Talk key"
          value={talk}
          onChange={setTalk}
          options={[...TALK_KEYS]}
        />
        <p className="wt-help">(hold it on its own)</p>
      </div>
      <div className="wt-row wt-switchrow">
        <div>
          <span className="wt-strong">Scout talks</span>
          <p className="wt-help">Reads answers aloud, so you can look away.</p>
        </div>
        <Toggle id="wt-talks" label="Scout talks" checked={enabled} onChange={setEnabled} />
      </div>
      <div>
        <Select
          id="wt-mouth"
          label="Who speaks"
          value={mouth}
          onChange={(next) => setMouth(next === 'system' ? 'system' : 'kokoro')}
          options={[
            { value: 'kokoro', label: 'Kokoro (on the brain)' },
            { value: 'system', label: 'System voice' },
          ]}
        />
        <p className="wt-help">
          Made on your computer. The voice downloads the first time Scout speaks (about 92 MB);
          until then Scout uses the Windows voice.
        </p>
      </div>
      <div>
        <div className="wt-pair">
          <Select
            id="wt-voice"
            label="Voice"
            value={voice}
            onChange={setVoice}
            options={[...VOICES]}
          />
          <Button
            variant="secondary"
            onClick={() => {
              setPreviewFailed(false);
              host
                .previewVoice({ text: SAMPLE, mouth, voice, speed })
                .catch(() => setPreviewFailed(true));
            }}
          >
            Preview
          </Button>
        </div>
        {previewFailed && <p className="wt-help">The preview could not play.</p>}
      </div>
      <Slider
        id="wt-speed"
        label="Speed"
        value={speed}
        min={0.7}
        max={1.3}
        step={0.05}
        onChange={setSpeed}
        format={(n) => `${n.toFixed(2)}x`}
      />
      <Select id="wt-mic" label="Microphone" value={mic} onChange={setMic} options={micOptions} />
      <MicTest watch={host.watchMicLevel} deviceId={mic === '' ? undefined : mic} />
      <p className="wt-help">
        Your voice is turned into text by your own brain and is never stored. With the brain on this
        computer, it never leaves it. The listening models download the first time you talk (about
        43 MB).
      </p>
    </div>
  );
}

export function StepFive({ host }: { host: WalkthroughHost }) {
  const { settings, failed } = useWalkthroughSettings(host);
  return (
    <section>
      <span className="wt-label">Voice</span>
      <h1>Talk to Scout, and hear it back</h1>
      <p className="wt-lead">
        Hold the talk key, ask out loud, let go. Scout answers in short spoken sentences, and the
        words show in the bubble too.
      </p>
      {settings !== null && <VoiceForm host={host} settings={settings} />}
      {failed && (
        <p className="wt-error" role="alert">
          Scout could not read your settings.
        </p>
      )}
    </section>
  );
}
