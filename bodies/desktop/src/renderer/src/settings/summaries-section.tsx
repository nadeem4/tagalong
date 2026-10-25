/**
 * Settings' Summaries group, under Advanced: which brain folds long conversations into a short
 * memory note, "Same as Scout" or one model from a service that can be used now. Controlled,
 * because the lists arrive after the page does and an uncontrolled select would lose the saved
 * choice.
 */
import type { SummarizerGroup } from '../settings-form';
import { Info, Tip, useInvalid } from './section';

export function SummariesSection({
  groups,
  value,
  onChange,
}: {
  groups: readonly SummarizerGroup[];
  value: string;
  onChange: (value: string) => void;
}) {
  const invalid = useInvalid('summarizer');
  return (
    <div className="tg-group">
      <div className="tg-titlerow">
        <h3 className="tg-sub">Summaries</h3>
        <Info tip="summaries" label="About summaries" />
      </div>
      <p className="tg-help">
        Long chats are condensed into a short note so every ask stays quick.
      </p>
      <Tip tip="summaries">
        After 20 messages, everything but the newest four is condensed into a short memory note, and
        that note is sent in their place from then on. Each summary is one extra model call. On your
        Claude sign-in it costs no money but counts toward your plan&apos;s usage, so a smaller
        model uses less of it. &ldquo;Same as Scout&rdquo; is right for most people. Only services
        that can be used now are listed.
      </Tip>
      <label className="tg-narrow" htmlFor={invalid.props.id}>
        <span>Summarize with</span>
        <select
          name="summarizer"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          {...invalid.props}
        >
          <option value="">Same as Scout (default)</option>
          {groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {invalid.message}
    </div>
  );
}
