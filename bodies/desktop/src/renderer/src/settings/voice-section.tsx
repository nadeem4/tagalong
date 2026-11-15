/**
 * Settings' Voice section: Scout's voice on or off, who speaks and who listens, the shared
 * "Scout's voice" card (it saves its own pick at once), how fast. Then Talk to Scout: the key you hold
 * to speak, and which microphone listens, with a local level test. The pickers and the speed
 * are the shared controls, which have no form name, so each value rides in a hidden input
 * that buildSettingsPatch reads.
 */
import { useEffect, useState } from 'react';
import { MicTest, Select, Slider, Toggle, VoiceField, useHostBridge } from '@tagalong/ui';
import type { MicWatcher } from '@tagalong/ui';
import {
  MAX_VOICE_SPEED,
  MIN_VOICE_SPEED,
  SETTINGS_DEFAULTS,
  TALK_KEYS,
  TALK_KEY_LABELS,
} from '../../../shared/settings';
import { adaptersFor, chosenMouth } from '../../../shared/voice';
import type { Settings } from '../../../shared/settings';
import { listMicrophones, openMic } from '../mic';
import { watchLevel } from '../mic-level';
import { voiceFacts } from '../settings-form';
import { Info, Section, Tip, useInvalid } from './section';

/**
 * The level meter's own short-lived mic, not the talk key's. Talking happens in another window,
 * which this one cannot see, so the test stops whenever this window loses focus instead.
 */
const watchMicLevel: MicWatcher = (deviceId, onLevel, onError) =>
  watchLevel(() => openMic(deviceId), onLevel, onError);

const MOUTHS = adaptersFor('mouth');
const EARS = adaptersFor('ears');

export function VoiceSection({
  settings,
  hotkeyError,
}: {
  settings: Settings;
  hotkeyError?: string | undefined;
}) {
  const bridge = useHostBridge();
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
  const [speed, setSpeed] = useState(settings.voice.speed);
  const speedField = useInvalid('voiceSpeed');
  // The refused-key sentence names the key in brackets; the Talk key select points at it too.
  const hotkeyRefused = hotkeyError?.includes(`(${talkKey})`) === true;

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
        which shows in the bubble and is not read. Under Who speaks, Scout's voice runs on the
        brain, which starts downloading the voice you pick as soon as you pick it; until it is ready
        Scout speaks with the system voice. The system voice needs nothing. Closing the bubble or
        the stop key silences it at once.
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
      <VoiceField host={bridge} speed={speed} />
      <div className="tg-grid">
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
            invalid={speedField.props['aria-invalid'] === true}
            describedBy={speedField.props['aria-describedby']}
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
            invalid={hotkeyRefused}
            describedBy={hotkeyRefused ? 'hotkey-error' : undefined}
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
      <MicTest
        watch={watchMicLevel}
        deviceId={microphone === '' ? undefined : microphone}
        stopOnBlur
      />
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
