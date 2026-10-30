/**
 * Settings' Voice section: Scout's voice on or off, who speaks and who listens, which voice, how
 * fast. Preview plays the form's choice before it is saved. ElevenLabs' key and voice are under
 * Advanced. Then Talk to Scout: the key you hold to speak, and which microphone listens.
 */
import { useEffect, useState } from 'react';
import {
  MAX_ELEVENLABS_SPEED,
  MAX_VOICE_SPEED,
  MIN_VOICE_SPEED,
  SETTINGS_DEFAULTS,
  TALK_KEYS,
  TALK_KEY_LABELS,
} from '../../../shared/settings';
import { adaptersFor, chosenMouth } from '../../../shared/voice';
import type { MouthId } from '@tagalong/ui/shapes';
import type { Settings, VoiceId } from '../../../shared/settings';
import { listMicrophones } from '../mic';
import { voiceFacts } from '../settings-form';
import { playLine } from '../voice-player';
import { Info, Section, Tip, useInvalid } from './section';

/** What ▶ Preview says, in the voice and at the speed the form shows. */
const PREVIEW_LINE = 'Certainly. I shall keep an eye on things and let you know what I find.';

const MOUTHS = adaptersFor('mouth');
const EARS = adaptersFor('ears');

/** The local voices, as a person picks them. */
const VOICES: readonly { id: VoiceId; label: string }[] = [
  { id: 'bm_george', label: 'George: calm and measured (default)' },
  { id: 'bm_fable', label: 'Fable: warmer, a storyteller' },
];

export function VoiceSection({
  settings,
  hotkeyError,
}: {
  settings: Settings;
  hotkeyError?: string | undefined;
}) {
  const [talks, setTalks] = useState(settings.voice.enabled);
  const talkKey = settings.hotkeys.talk ?? SETTINGS_DEFAULTS.hotkeys.talk;
  const talkRefused = hotkeyError?.includes(`(${TALK_KEY_LABELS[talkKey]})`) === true;
  const [microphones, setMicrophones] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    listMicrophones()
      .then(setMicrophones)
      .catch((error: unknown) => console.warn('[voice] could not list microphones', error));
  }, []);
  const picked = settings.voice.microphoneId ?? '';
  const [mouth, setMouth] = useState<string>(chosenMouth(settings.voice));
  const [voice, setVoice] = useState<VoiceId>(settings.voice.voice);
  const [speed, setSpeed] = useState(settings.voice.speed);
  const [previewing, setPreviewing] = useState(false);
  const speedField = useInvalid('voiceSpeed');
  // ElevenLabs refuses more than its cap, so its slider stops there and shows a higher saved speed as the cap.
  const maxSpeed = mouth === 'elevenlabs' ? MAX_ELEVENLABS_SPEED : MAX_VOICE_SPEED;
  const shownSpeed = Math.min(speed, maxSpeed);

  const preview = (): void => {
    setPreviewing(true);
    playLine(PREVIEW_LINE, new AbortController().signal, {
      voice,
      speed: shownSpeed,
      mouth: mouth as MouthId,
    })
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
        <button
          type="button"
          role="switch"
          className="tg-switch"
          aria-checked={talks}
          aria-labelledby="talks-label"
          onClick={() => setTalks((on) => !on)}
        >
          {talks ? 'On' : 'Off'}
        </button>
        {talks && <input type="hidden" name="voiceEnabled" value="on" />}
      </div>
      <Tip tip="voice">
        Scout says what it writes: its answers, its hello and a watch that fires. Drafts, code and
        long lists it puts in a block, which shows in the bubble and is not read. Under Who speaks,
        the local voice runs on this computer and downloads its model (about 90 MB) the first time
        it is used, speaking with the system voice until that is done; ElevenLabs needs your key;
        the system voice needs nothing. Closing the bubble or the stop key silences it at once.
      </Tip>
      <div className="tg-grid">
        <div>
          <label htmlFor="f-mouth">Who speaks</label>
          <select
            id="f-mouth"
            name="mouth"
            value={mouth}
            onChange={(event) => setMouth(event.target.value)}
          >
            {MOUTHS.map((adapter) => (
              <option key={adapter.id} value={adapter.id}>
                {adapter.label}
              </option>
            ))}
          </select>
          <p className="tg-help">
            {voiceFacts(MOUTHS.find((adapter) => adapter.id === mouth) ?? MOUTHS[0]!)}
          </p>
        </div>
        <div>
          <label htmlFor="f-ears">Who listens</label>
          <select id="f-ears" name="ears" defaultValue={settings.voice.ears ?? 'local'}>
            {EARS.map((adapter) => (
              <option key={adapter.id} value={adapter.id}>
                {adapter.label}
              </option>
            ))}
          </select>
          <p className="tg-help">{voiceFacts(EARS[0]!)}</p>
        </div>
      </div>
      <div className="tg-grid">
        <div>
          <label htmlFor="f-voice">Voice</label>
          <div className="tg-actions tg-voice-pick">
            <select
              id="f-voice"
              name="voice"
              value={voice}
              onChange={(event) => setVoice(event.target.value as VoiceId)}
            >
              {VOICES.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
            <button type="button" className="tg-btn-quiet" onClick={preview} disabled={previewing}>
              <span aria-hidden="true">▶</span> Preview
            </button>
          </div>
        </div>
        <div>
          <label htmlFor={speedField.props.id}>Speed: {shownSpeed.toFixed(2)}×</label>
          <input
            name="voiceSpeed"
            type="range"
            min={MIN_VOICE_SPEED}
            max={maxSpeed}
            step={0.05}
            value={shownSpeed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            {...speedField.props}
          />
          {speedField.message}
        </div>
      </div>
      <div className="tg-grid">
        <div>
          <div className="tg-labelrow">
            <label htmlFor="f-talkHotkey">Talk to Scout</label>
            <Info tip="talk" label="About talking to Scout" />
          </div>
          <select
            id="f-talkHotkey"
            name="talkHotkey"
            defaultValue={talkKey}
            {...(talkRefused
              ? { 'aria-invalid': true as const, 'aria-describedby': 'hotkey-error' }
              : {})}
          >
            {TALK_KEYS.map((key) => (
              <option key={key} value={key}>
                {TALK_KEY_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-microphone">Microphone</label>
          <select id="f-microphone" name="microphoneId" defaultValue={picked}>
            <option value="">System default</option>
            {microphones.map((microphone) => (
              <option key={microphone.id} value={microphone.id}>
                {microphone.label}
              </option>
            ))}
            {picked !== '' && !microphones.some((microphone) => microphone.id === picked) && (
              <option value={picked}>The microphone picked before</option>
            )}
          </select>
        </div>
      </div>
      <p className="tg-help">
        Hold the key on its own and speak; let go and Scout answers out loud. Pressing another key
        while you hold it (Right Ctrl+C, say) sends nothing. Tagalong watches only this key go down
        and up; nothing you type is read or kept. Your speech is turned into text on this PC, and
        the recording is never sent or kept.
      </p>
      <Tip tip="talk">
        Hold the key, or click the mic in the bubble, and say your question. Let go (or click again)
        and Scout answers in short spoken sentences, with any detail in the bubble. Talking while
        Scout speaks cuts it off. The microphone only listens while you hold the key or after you
        click the mic: never on its own. The first time, Tagalong downloads its speech models (about
        43 MB) that turn your voice into text on this PC.
      </Tip>
    </Section>
  );
}
