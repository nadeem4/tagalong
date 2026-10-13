import { SETTINGS_DEFAULTS } from '@tagalong/protocol';
import type { Settings } from '@tagalong/protocol';
import { Section } from './section';

/**
 * The two global hotkeys: the ask, which brings the selected text and the window you are on,
 * and the pause. Scout takes screenshots and reads other windows itself, so neither has a key. Every one is sent on every save (see `buildSettingsPatch`), and
 * main re-registers them, reporting a key it could not take back as `hotkeyError`.
 */
export function HotkeysSection({
  settings,
  hotkeyError,
}: {
  settings: Settings;
  hotkeyError: string | undefined;
}) {
  return (
    <Section id="hotkeys">
      <label>
        <span>Ask hotkey (brings the text you selected)</span>
        <input name="askHotkey" defaultValue={settings.hotkeys.ask} />
      </label>
      <label>
        <span>Pause sight hotkey (turns all looking off and on)</span>
        <input
          name="pauseSightHotkey"
          defaultValue={settings.hotkeys.pauseSight ?? SETTINGS_DEFAULTS.hotkeys.pauseSight}
        />
      </label>
      {hotkeyError !== undefined && (
        <p className="tg-error" role="alert">
          {hotkeyError}
        </p>
      )}
    </Section>
  );
}
