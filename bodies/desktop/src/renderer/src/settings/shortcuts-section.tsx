/**
 * Settings' Shortcuts section: the ask key, which brings the selected text and the window you
 * are on, the pause key and the key that stops Scout speaking (the talk key is under Voice).
 * Every hotkey is sent on every save (see buildSettingsPatch); main re-registers them and
 * reports one it could not take as `hotkeyError`, shown here on the field it names. Each key is
 * drawn as keycaps that follow the text field, which still holds the accelerator being edited.
 */
import { useState } from 'react';
import { Shortcut } from '@tagalong/ui';
import { SETTINGS_DEFAULTS } from '../../../shared/settings';
import type { Settings } from '../../../shared/settings';
import { Info, Section, Tip } from './section';

/** One shortcut: its keycaps (live as you type) above the field that holds the accelerator. */
function ShortcutField({
  field,
  saved,
  invalid,
}: {
  field: string;
  saved: string;
  invalid: Record<string, unknown>;
}) {
  const [accelerator, setAccelerator] = useState(saved);
  return (
    <>
      <Shortcut accelerator={accelerator} />
      <input
        id={`f-${field}`}
        name={field}
        value={accelerator}
        onChange={(event) => setAccelerator(event.target.value)}
        {...invalid}
      />
    </>
  );
}

export function ShortcutsSection({
  settings,
  hotkeyError,
}: {
  settings: Settings;
  hotkeyError: string | undefined;
}) {
  const ask = settings.hotkeys.ask;
  const pause = settings.hotkeys.pauseSight ?? SETTINGS_DEFAULTS.hotkeys.pauseSight;
  const stopVoice = settings.hotkeys.stopVoice ?? SETTINGS_DEFAULTS.hotkeys.stopVoice;
  const refused = (accelerator: string) =>
    hotkeyError?.includes(`(${accelerator})`) === true
      ? { 'aria-invalid': true as const, 'aria-describedby': 'hotkey-error' }
      : {};
  return (
    <Section id="shortcuts">
      <div className="tg-grid">
        <div>
          <div className="tg-labelrow">
            <label htmlFor="f-askHotkey">Ask Scout about what you highlighted</label>
            <Info tip="ask" label="About the ask shortcut" />
          </div>
          <ShortcutField field="askHotkey" saved={ask} invalid={refused(ask)} />
        </div>
        <div>
          <div className="tg-labelrow">
            <label htmlFor="f-pauseSightHotkey">Pause sight</label>
          </div>
          <ShortcutField field="pauseSightHotkey" saved={pause} invalid={refused(pause)} />
        </div>
        <div>
          <div className="tg-labelrow">
            <label htmlFor="f-stopVoiceHotkey">Stop Scout speaking</label>
            <Info tip="stopVoice" label="About the stop speaking shortcut" />
          </div>
          <ShortcutField field="stopVoiceHotkey" saved={stopVoice} invalid={refused(stopVoice)} />
        </div>
      </div>
      {hotkeyError !== undefined && (
        <p className="tg-error tg-field-error" id="hotkey-error" role="alert">
          {hotkeyError}
        </p>
      )}
      <Tip tip="ask">
        Highlight text anywhere and press this. Scout&apos;s bubble opens with that text already in
        it. Clicking Scout opens the bubble without copying anything. Type the keys joined with +,
        like Ctrl+Shift+Space.
      </Tip>
      <Tip tip="stopVoice">
        Scout stops talking at once, mid-sentence, and drops whatever it was about to say. Closing
        the bubble does the same. To keep Scout quiet for good, turn off Scout talks under Voice.
      </Tip>
    </Section>
  );
}
