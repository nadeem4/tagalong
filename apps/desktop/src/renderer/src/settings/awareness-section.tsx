import { MAX_ROLLING_MEMORY_MINUTES, SETTINGS_DEFAULTS } from '@tagalong/protocol';
import type { Settings } from '@tagalong/protocol';
import { Section } from './section';

/** Rolling memory and the limits on watches. */
export function AwarenessSection({ settings }: { settings: Settings }) {
  return (
    <Section id="awareness">
      <label className="tg-check">
        <input
          type="checkbox"
          name="rollingMemoryEnabled"
          defaultChecked={settings.rollingMemory.enabled}
        />
        <span>Rolling memory: remember the last few minutes of the screen</span>
      </label>
      <label>
        <span>Minutes to remember</span>
        <input
          name="rollingMemoryMinutes"
          type="number"
          min={1}
          max={MAX_ROLLING_MEMORY_MINUTES}
          defaultValue={settings.rollingMemory.minutes}
        />
      </label>
      <p className="tg-note">
        Every five seconds, a 640-pixel picture of each screen and the list of open windows, kept in
        memory only — never written to disk. Pausing sight or quitting throws it all away, and
        excluded apps are never recorded. A red dot on the pets shows while it records. Lets you ask
        “what was I reading five minutes ago?”.
      </p>
      <label>
        <span>Checks per watch (model calls one watch may make)</span>
        <input
          name="watchMaxChecks"
          type="number"
          min={1}
          max={500}
          defaultValue={settings.watch.maxChecks}
        />
      </label>
      <label>
        <span>Watches at once</span>
        <input
          name="watchMaxConcurrent"
          type="number"
          min={1}
          max={10}
          defaultValue={settings.watch.maxConcurrent}
        />
      </label>
      <label>
        <span>Watch timeout when the pet names none (minutes)</span>
        <input
          name="watchTimeoutMinutes"
          type="number"
          min={1}
          max={24 * 60}
          defaultValue={settings.watch.defaultTimeoutMinutes}
        />
      </label>
      <p className="tg-note">
        “Tell me when this finishes” starts a watch. Tagalong compares the screen on this machine
        every five seconds and only asks the pet’s small check model when something changed and
        settled, so most checks cost nothing. Defaults: {SETTINGS_DEFAULTS.watch.maxChecks} checks,{' '}
        {SETTINGS_DEFAULTS.watch.maxConcurrent} at once,{' '}
        {SETTINGS_DEFAULTS.watch.defaultTimeoutMinutes} minutes.
      </p>
    </Section>
  );
}
