import { MAX_WINDOW_TEXT_CHARS, SETTINGS_DEFAULTS } from '@tagalong/protocol';
import type { Settings } from '@tagalong/protocol';
import { Section } from './section';

/** The two controls over what looking costs. Both are read per capture. */
export function SightSection({ settings }: { settings: Settings }) {
  return (
    <Section id="sight">
      <label>
        <span>What a look at every screen sends</span>
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
