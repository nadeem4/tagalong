import { useState } from 'react';
import { MAX_VOICE_SPEED, MIN_VOICE_SPEED } from '@tagalong/protocol';
import type { Settings, VoiceId } from '@tagalong/protocol';
import { playLine } from '../voice-player';
import { Section, Tip, useInvalid } from './section';

/** What ▶ Preview says, in the voice and at the speed the form shows. */
const PREVIEW_LINE = 'Certainly. I shall keep an eye on things and let you know what I find.';

/** The local voices, as a person picks them. */
const VOICES: readonly { id: VoiceId; label: string }[] = [
  { id: 'bm_george', label: 'George: calm and measured (default)' },
  { id: 'bm_fable', label: 'Fable: warmer, a storyteller' },
];

/**
 * Scout talks: on or off, which voice, how fast. Preview plays the form's choice before it
 * is saved. ElevenLabs, the bring-your-own-key voice, is under Advanced.
 */
export function VoiceSection({ settings }: { settings: Settings }) {
  const [talks, setTalks] = useState(settings.voice.enabled);
  const [voice, setVoice] = useState<VoiceId>(settings.voice.voice);
  const [speed, setSpeed] = useState(settings.voice.speed);
  const [previewing, setPreviewing] = useState(false);
  const speedField = useInvalid('voiceSpeed');

  const preview = (): void => {
    setPreviewing(true);
    playLine(PREVIEW_LINE, new AbortController().signal, { voice, speed })
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
        Scout says its answers, its hello, a watch that fires and an expert that finished. Code,
        lists and long text stay in the bubble: Scout says the first sentence or two and &ldquo;The
        rest is in the bubble.&rdquo; The voice runs on this computer. The first time it speaks it
        downloads the voice model (about 90 MB) and uses the system voice until that is done.
        Closing the bubble or the stop key silences it at once.
      </Tip>
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
          <label htmlFor={speedField.props.id}>Speed: {speed.toFixed(2)}×</label>
          <input
            name="voiceSpeed"
            type="range"
            min={MIN_VOICE_SPEED}
            max={MAX_VOICE_SPEED}
            step={0.05}
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            {...speedField.props}
          />
          {speedField.message}
        </div>
      </div>
    </Section>
  );
}
