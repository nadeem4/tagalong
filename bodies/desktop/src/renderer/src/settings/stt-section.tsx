/**
 * Settings' "Speech to text" card: which speech models the brain uses while you talk and when
 * you finish (the shared VoiceModelsField, saved at once), and the Show words while I talk switch,
 * which is a desktop setting saved with the rest of the form through a hidden input.
 */
import { useState } from 'react';
import { Toggle, VoiceModelsField, useHostBridge } from '@tagalong/ui';
import type { Settings } from '../../../shared/settings';
import { Info, Tip } from './section';

export function SttSection({ settings }: { settings: Settings }) {
  const bridge = useHostBridge();
  const [showWords, setShowWords] = useState(settings.voice.showWordsWhileTalking !== false);
  return (
    <div id="stt">
      <VoiceModelsField
        host={bridge}
        liveInfo={<Info tip="stt-live" label="About while you talk" />}
        finalInfo={<Info tip="stt-final" label="About when you finish" />}
      >
        <Tip tip="stt-live">Turns your voice into words as you speak, so you see them appear.</Tip>
        <Tip tip="stt-final">
          Listens to the whole sentence again when you stop, for more accurate words.
        </Tip>
        <div className="tg-setting">
          <div className="tg-setting__text">
            <div className="tg-labelrow">
              <h3 className="tg-sub" id="show-words-label">
                Show words while I talk
              </h3>
              <Info tip="stt-show" label="About showing words while you talk" />
            </div>
          </div>
          <Toggle label="Show words while I talk" checked={showWords} onChange={setShowWords} />
          {showWords && <input type="hidden" name="showWordsWhileTalking" value="on" />}
        </div>
        <Tip tip="stt-show">When off, your words appear only after you let go of the talk key.</Tip>
      </VoiceModelsField>
    </div>
  );
}
