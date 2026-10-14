import type { Settings } from '@tagalong/protocol';
import { Info, Tip, useInvalid } from './section';

/**
 * ElevenLabs, the optional premium voice: the person's own key and a voice from their own
 * library. Both are needed; with either missing Scout keeps its local voice. The key is
 * stored like the others and never read back into the form.
 */
export function ElevenLabsSection({
  settings,
  keyStored,
  typed,
  onType,
  onRemove,
}: {
  settings: Settings;
  keyStored: boolean;
  typed: string;
  onType: (value: string) => void;
  onRemove: () => void;
}) {
  const voiceId = useInvalid('elevenLabsVoiceId');
  return (
    <div className="tg-group">
      <div className="tg-titlerow">
        <h3 className="tg-sub">ElevenLabs voice (optional)</h3>
        <Info tip="elevenlabs" label="About the ElevenLabs voice" />
      </div>
      <p className="tg-help">
        Your own ElevenLabs key and voice, used when you pick ElevenLabs under Who speaks.
      </p>
      <Tip tip="elevenlabs">
        Pick ElevenLabs, with your key under Settings → Voice → Who speaks, then add a key and a
        voice ID here and Scout speaks through ElevenLabs&apos; fast Flash model. Only the words
        Scout says are sent, never your screen or your questions, and ElevenLabs bills your account
        for them. Pick a voice in your ElevenLabs voice library, such as a British male voice, and
        paste its voice ID here. If ElevenLabs fails, Scout uses the local voice.
      </Tip>
      <div className="tg-grid">
        <div>
          <label htmlFor="f-key-elevenlabs">
            {keyStored ? 'Replace ElevenLabs key' : 'ElevenLabs key'}
          </label>
          <input
            id="f-key-elevenlabs"
            type="password"
            name="key:elevenlabs"
            autoComplete="off"
            placeholder={keyStored ? 'Type a new key to replace it' : 'Paste your key'}
            value={typed}
            onChange={(event) => onType(event.target.value)}
          />
          {keyStored && (
            <div className="tg-actions">
              <span className="tg-chip tg-chip--ok">Key stored</span>
              <button type="button" className="tg-btn-quiet" onClick={onRemove}>
                Remove key<span className="tg-sr"> for ElevenLabs</span>
              </button>
            </div>
          )}
        </div>
        <div>
          <label htmlFor={voiceId.props.id}>Voice ID</label>
          <input
            name="elevenLabsVoiceId"
            defaultValue={settings.voice.elevenLabsVoiceId}
            placeholder="From your ElevenLabs voice library"
            autoComplete="off"
            {...voiceId.props}
          />
          {voiceId.message}
        </div>
      </div>
    </div>
  );
}
