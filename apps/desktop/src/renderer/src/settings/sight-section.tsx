import { useState } from 'react';
import { MAX_WINDOW_TEXT_CHARS, SETTINGS_DEFAULTS } from '@tagalong/protocol';
import type { Settings } from '@tagalong/protocol';
import { SightPermission } from '@tagalong/ui';
import { Section } from './section';

/**
 * The sight permission, then the two controls over what looking costs.
 *
 * The permission is saved the moment it is chosen rather than with the form: it is a
 * permission, and a choice that only took effect after a Save further down the page would
 * leave the user believing the pet could not see when it could, or the reverse.
 */
export function SightSection({ settings }: { settings: Settings }) {
  const [sight, setSight] = useState(settings.sight);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function choose(mode: Settings['sight']): void {
    const before = sight;
    setSight(mode);
    setSaving(true);
    setProblem(null);
    window.tagalongHost
      .saveSettings({ sight: mode })
      .then((saved) => setSight(saved.sight))
      .catch((error: unknown) => {
        setSight(before);
        setProblem(error instanceof Error ? error.message : 'The sight permission was not saved.');
      })
      .finally(() => setSaving(false));
  }

  return (
    <Section id="sight">
      <SightPermission value={sight} onChange={choose} disabled={saving} />
      <p className="tg-note">
        Applies as soon as you choose. In both, excluded apps are never read, and pausing sight from
        its hotkey or the tray stops all looking.
      </p>
      {problem !== null && (
        <p className="settings__error" role="alert">
          {problem}
        </p>
      )}
      <label>
        <span>What a see-everything look sends</span>
        <select name="sightDetail" defaultValue={settings.sightDetail}>
          <option value="focused">
            The composite and the screen you are on (cheaper, recommended)
          </option>
          <option value="all">Every screen as its own picture</option>
        </select>
      </label>
      <p className="tg-note">
        Every screen sends one picture per monitor. On a three-monitor desk that is roughly three
        times the image cost on every look, so the default sends an overview plus the screen you are
        working on and lets the pet ask for another if it needs one.
      </p>
      <label>
        <span>Window text budget (characters per window read)</span>
        <input
          name="windowTextBudget"
          type="number"
          min={1}
          max={MAX_WINDOW_TEXT_CHARS}
          step={500}
          defaultValue={settings.windowTextBudget}
        />
      </label>
      <p className="tg-note">
        How much of a window the pet reads when it does not ask for less. Roughly one token per four
        characters, so {SETTINGS_DEFAULTS.windowTextBudget} is about{' '}
        {Math.round(SETTINGS_DEFAULTS.windowTextBudget / 4)} tokens per window read — raising it
        costs that much more every time, on every read.
      </p>
    </Section>
  );
}
