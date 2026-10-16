/**
 * Settings' Sight detail group, under Advanced: the two controls over what looking costs. Both
 * are read per capture.
 */
import { MAX_WINDOW_TEXT_CHARS, SETTINGS_DEFAULTS } from '@tagalong/protocol';
import type { Settings } from '@tagalong/protocol';
import { Info, Tip, useInvalid } from './section';

const DEFAULT_BUDGET = SETTINGS_DEFAULTS.windowTextBudget;

export function SightSection({ settings }: { settings: Settings }) {
  const budget = useInvalid('windowTextBudget');
  return (
    <div className="tg-group">
      <h3 className="tg-sub">Sight detail</h3>
      <div className="tg-grid">
        <div>
          <div className="tg-labelrow">
            <label htmlFor="f-sightDetail">With several monitors, a look sends</label>
            <Info tip="monitors" label="About monitors" />
          </div>
          <select id="f-sightDetail" name="sightDetail" defaultValue={settings.sightDetail}>
            <option value="focused">An overview and your current screen (default)</option>
            <option value="all">Every screen as its own picture</option>
          </select>
        </div>
        <div>
          <div className="tg-labelrow">
            <label htmlFor={budget.props.id}>Text read per window (characters)</label>
            <Info tip="text" label="About window text" />
          </div>
          <input
            name="windowTextBudget"
            type="number"
            min={1}
            max={MAX_WINDOW_TEXT_CHARS}
            step={500}
            defaultValue={settings.windowTextBudget}
            {...budget.props}
          />
          {budget.message}
        </div>
      </div>
      <Tip tip="monitors">
        Each screen sent is one more picture on every look. On a three-monitor desk, &ldquo;every
        screen&rdquo; costs about three times as much. The default sends one overview plus the
        screen you are working on, and Scout can ask for another screen when it needs it.
      </Tip>
      <Tip tip="text">
        How much of a window Scout reads when it reads one. About four characters make one token, so{' '}
        {DEFAULT_BUDGET.toLocaleString('en-US')} is about{' '}
        {Math.round(DEFAULT_BUDGET / 4).toLocaleString('en-US')} tokens per window read. Raising it
        lets Scout see more of long pages and costs that much more on every read.
      </Tip>
    </div>
  );
}
