import { SETTINGS_DEFAULTS } from '@tagalong/protocol';
import type { Settings } from '@tagalong/protocol';
import { Section } from './section';

/**
 * The four global hotkeys. Every one is sent on every save (see `buildSettingsPatch`), and
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
        <span>Ask hotkey (text only)</span>
        <input name="askHotkey" defaultValue={settings.hotkeys.ask} />
      </label>
      <label>
        <span>Look hotkey (adds a screenshot)</span>
        <input
          name="lookHotkey"
          defaultValue={settings.hotkeys.look ?? SETTINGS_DEFAULTS.hotkeys.look}
        />
      </label>
      <label>
        <span>See-everything hotkey (every screen, plus what is open)</span>
        <input
          name="seeEverythingHotkey"
          defaultValue={settings.hotkeys.seeEverything ?? SETTINGS_DEFAULTS.hotkeys.seeEverything}
        />
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
