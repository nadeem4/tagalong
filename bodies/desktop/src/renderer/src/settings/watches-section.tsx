/**
 * Settings' Screen memory and watches group, under Advanced: how much screen memory keeps, and
 * the limits on watches. Rolling memory's switch is in Privacy.
 */
import { MAX_ROLLING_MEMORY_MINUTES } from '@tagalong/protocol';
import type { Settings } from '@tagalong/protocol';
import { Info, Tip, useInvalid } from './section';

export function WatchesSection({ settings }: { settings: Settings }) {
  return (
    <div className="tg-group">
      <div className="tg-titlerow">
        <h3 className="tg-sub">Screen memory and watches</h3>
        <Info tip="watch" label="About watches" />
      </div>
      <Tip tip="watch">
        &ldquo;Tell me when this finishes&rdquo; starts a watch. Tagalong compares the screen on
        this computer every five seconds and only asks the model when something changed and settled,
        so most checks cost nothing. Checks per watch caps those model calls; watches at once caps
        how many run together; the timeout ends a watch nobody gave a time limit. Minutes of screen
        to remember applies only when screen memory is on.
      </Tip>
      <div className="tg-grid tg-grid--narrow">
        <NumberField
          name="rollingMemoryMinutes"
          label="Minutes of screen to remember"
          max={MAX_ROLLING_MEMORY_MINUTES}
          value={settings.rollingMemory.minutes}
        />
        <NumberField
          name="watchMaxChecks"
          label="Checks per watch"
          max={500}
          value={settings.watch.maxChecks}
        />
        <NumberField
          name="watchMaxConcurrent"
          label="Watches at once"
          max={10}
          value={settings.watch.maxConcurrent}
        />
        <NumberField
          name="watchTimeoutMinutes"
          label="Watch gives up after (minutes)"
          max={24 * 60}
          value={settings.watch.defaultTimeoutMinutes}
        />
      </div>
    </div>
  );
}

function NumberField({
  name,
  label,
  max,
  value,
}: {
  name: string;
  label: string;
  max: number;
  value: number;
}) {
  const invalid = useInvalid(name);
  return (
    <div>
      <label htmlFor={invalid.props.id}>
        <span>{label}</span>
        <input
          name={name}
          type="number"
          min={1}
          max={max}
          defaultValue={value}
          {...invalid.props}
        />
      </label>
      {invalid.message}
    </div>
  );
}
