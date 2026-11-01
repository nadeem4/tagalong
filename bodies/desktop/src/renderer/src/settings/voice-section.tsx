/**
 * Settings' Voice section: Scout's voice on or off, who speaks and who listens, which voice, how
 * fast. Preview plays the form's choice before it is saved. Then Talk to Scout: the key you hold
 * to speak, and which microphone listens. The pickers and the speed are the shared controls, which
 * have no form name, so each value rides in a hidden input that buildSettingsPatch reads.
 */
import { useEffect, useState } from 'react';
import { Button, Select, Slider, Toggle } from '@tagalong/ui';
import {
  MAX_VOICE_SPEED,
  MIN_VOICE_SPEED,
  SETTINGS_DEFAULTS,
  TALK_KEYS,
  TALK_KEY_LABELS,
} from '../../../shared/settings';
import { adaptersFor, chosenMouth } from '../../../shared/voice';
import type { Settings, VoiceId } from '../../../shared/settings';
import { listMicrophones } from '../mic';
import { voiceFacts } from '../settings-form';
import { previewVoice } from '../voice-player';
import { Info, Section, Tip, useInvalid } from './section';

/** What ▶ Preview says, in the voice and at the speed the form shows. */
const PREVIEW_LINE = 'Certainly. I shall let you know what I find.';

const MOUTHS = adaptersFor('mouth');
const EARS = adaptersFor('ears');

/** The local voices, as a person picks them. */
const VOICES: readonly { id: VoiceId; label: string }[] = [
  { id: 'bm_george', label: 'George: calm and measured (default)' },
  { id: 'bm_fable', label: 'Fable: warmer, a storyteller' },
];

export function VoiceSection({ settings }: { settings: Settings }) {
  const [talks, setTalks] = useState(settings.voice.enabled);
  const talkKey = settings.hotkeys.talk ?? SETTINGS_DEFAULTS.hotkeys.talk;
  const [microphones, setMicrophones] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    listMicrophones()
      .then(setMicrophones)
      .catch((error: unknown) => console.warn('[voice] could not list microphones', error));
  }, []);
  const picked = settings.voice.microphoneId ?? '';
  const [microphone, setMicrophone] = useState(picked);
  const [ears, setEars] = useState<string>(settings.voice.ears ?? 'local');
  const [talkChoice, setTalkChoice] = useState<string>(talkKey);
  const [mouth, setMouth] = useState<string>(chosenMouth(settings.voice));
  const [voice, setVoice] = useState<VoiceId>(settings.voice.voice);
  const [speed, setSpeed] = useState(settings.voice.speed);
  const [previewing, setPreviewing] = useState(false);
  const speedField = useInvalid('voiceSpeed');

  const preview = (): void => {
    setPreviewing(true);
    previewVoice(
      { text: PREVIEW_LINE, mouth: mouth === 'system' ? 'system' : 'kokoro', voice, speed },
      new AbortController().signal,
    )
      .catch((error: unknown) => console.warn('[voice] preview failed', error))
      .finally(() => setPreviewing(false));
  };

  return (
    <Section id="voice" info={{ tip: 'voice', label: 'About Scout’s voice' }}>
      <div className="tg-setting">
        <div className="tg-setting__text">
          <h3 className="tg-sub" id="talks-label">
            Scout talks
          </h3>
          <p className="tg-help">Scout reads its answers aloud, so you can look away.</p>
        </div>
        <Toggle label="Scout talks" checked={talks} onChange={setTalks} />
        {talks && <input type="hidden" name="voiceEnabled" value="on" />}
      </div>
      <Tip tip="voice">
        Scout reads aloud the answers you ask for by voice. Code and long lists it puts in a block,
        which shows in the bubble and is not read. Under Who speaks, Kokoro runs on the brain, which
        downloads its model the first time it is needed; until it is ready Scout speaks with the
        system voice. The system voice needs nothing. Closing the bubble or the stop key silences it
        at once.
      </Tip>
      <div className="tg-grid">
        <div>
          <Select
            id="f-mouth"
            label="Who speaks"
            value={mouth}
            onChange={setMouth}
            options={MOUTHS.map((adapter) => ({ value: adapter.id, label: adapter.label }))}
          />
          <input type="hidden" name="mouth" value={mouth} />
          <p className="tg-help">
            {voiceFacts(MOUTHS.find((adapter) => adapter.id === mouth) ?? MOUTHS[0]!)}
          </p>
        </div>
        <div>
          <Select
            id="f-ears"
            label="Who listens"
            value={ears}
            onChange={setEars}
            options={EARS.map((adapter) => ({ value: adapter.id, label: adapter.label }))}
          />
          <input type="hidden" name="ears" value={ears} />
          <p className="tg-help">{voiceFacts(EARS[0]!)}</p>
        </div>
      </div>
      <div className="tg-grid">
        <div>
          <div className="tg-actions tg-voice-pick">
            <Select
              id="f-voice"
              label="Voice"
              value={voice}
              onChange={(next) => setVoice(next as VoiceId)}
              options={VOICES.map((choice) => ({ value: choice.id, label: choice.label }))}
            />
            <Button variant="quiet" onClick={preview} disabled={previewing}>
              <span aria-hidden="true">▶</span> Preview
            </Button>
          </div>
          <input type="hidden" name="voice" value={voice} />
        </div>
        <div>
          <Slider
            id={speedField.props.id}
            label="Speed"
            value={speed}
            min={MIN_VOICE_SPEED}
            max={MAX_VOICE_SPEED}
            step={0.05}
            onChange={setSpeed}
            format={(n) => `${n.toFixed(2)}×`}
          />
          <input type="hidden" name="voiceSpeed" value={speed} />
          {speedField.message}
        </div>
      </div>
      <div className="tg-grid">
        <div>
          <div className="tg-labelrow">
            <label htmlFor="f-talkHotkey">Talk to Scout</label>
            <Info tip="talk" label="About talking to Scout" />
          </div>
          <Select
            id="f-talkHotkey"
            value={talkChoice}
            onChange={setTalkChoice}
            options={TALK_KEYS.map((key) => ({ value: key, label: TALK_KEY_LABELS[key] }))}
          />
          <input type="hidden" name="talkHotkey" value={talkChoice} />
        </div>
        <div>
          <Select
            id="f-microphone"
            label="Microphone"
            value={microphone}
            onChange={setMicrophone}
            options={[
              { value: '', label: 'System default' },
              ...microphones.map((mic) => ({ value: mic.id, label: mic.label })),
              ...(picked !== '' && !microphones.some((mic) => mic.id === picked)
                ? [{ value: picked, label: 'The microphone picked before' }]
                : []),
            ]}
          />
          <input type="hidden" name="microphoneId" value={microphone} />
        </div>
      </div>
      <p className="tg-help">
        Hold the key on its own and speak; let go and Scout answers out loud. Pressing another key
        while you hold it (Right Ctrl+C, say) sends nothing. Tagalong watches only this key go down
        and up; nothing you type is read or kept. Audio goes only to your own brain and is never
        stored; with the brain on this computer it never leaves it.
      </p>
      <Tip tip="talk">
        Hold the key, or click the mic in the bubble, and say your question. Let go (or click again)
        and Scout answers in short spoken sentences, with any detail in the bubble. Talking while
        Scout speaks cuts it off. The microphone only listens while you hold the key or after you
        click the mic: never on its own. The brain turns your voice into text, and downloads its
        speech models the first time it needs them.
      </Tip>
    </Section>
  );
}
