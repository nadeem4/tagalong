import { SETTINGS_DEFAULTS } from '@tagalong/protocol';
import type { Settings } from '@tagalong/protocol';
import { Info, Section, Tip } from './section';

/**
 * The global hotkeys: the ask, which brings the selected text and the window you are on,
 * the pause, and the key that stops Scout speaking. All are sent on every save (see `buildSettingsPatch`), and main
 * re-registers them, reporting a key it could not take as `hotkeyError`, which is shown
 * here and marks the field whose combination it names.
 */
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
          <input id="f-askHotkey" name="askHotkey" defaultValue={ask} {...refused(ask)} />
        </div>
        <div>
          <div className="tg-labelrow">
            <label htmlFor="f-pauseSightHotkey">Pause sight</label>
          </div>
          <input
            id="f-pauseSightHotkey"
            name="pauseSightHotkey"
            defaultValue={pause}
            {...refused(pause)}
          />
        </div>
        <div>
          <div className="tg-labelrow">
            <label htmlFor="f-stopVoiceHotkey">Stop Scout speaking</label>
            <Info tip="stopVoice" label="About the stop speaking shortcut" />
          </div>
          <input
            id="f-stopVoiceHotkey"
            name="stopVoiceHotkey"
            defaultValue={stopVoice}
            {...refused(stopVoice)}
          />
        </div>
      </div>
      {hotkeyError !== undefined && (
        <p className="tg-error tg-field-error" id="hotkey-error" role="alert">
          {hotkeyError}
        </p>
      )}
      <Tip tip="ask">
        Highlight text anywhere and press this. Scout&apos;s bubble opens with that text already in
        it. Clicking Scout opens the bubble without copying anything. Use CommandOrControl, Shift,
        Alt and a key, joined with +.
      </Tip>
      <Tip tip="stopVoice">
        Scout stops talking at once, mid-sentence, and drops whatever it was about to say. Closing
        the bubble does the same. To keep Scout quiet for good, turn off Scout talks under Voice.
      </Tip>
    </Section>
  );
}
