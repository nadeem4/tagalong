import type { Settings } from '@tagalong/protocol';
import type { ProviderChoice } from '../../../shared/ipc';
import { Section } from './section';

/** Which brain folds long conversations into a short memory. */
export function SummariesSection({
  providers,
  settings,
}: {
  providers: readonly ProviderChoice[];
  settings: Settings;
}) {
  return (
    <Section id="summaries">
      <label>
        <span>Summarizer provider (blank: each pet uses its own)</span>
        <select name="summarizerProviderId" defaultValue={settings.summarizer?.providerId ?? ''}>
          <option value="">Each pet&apos;s own provider</option>
          {providers.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Summarizer model id (blank: each pet uses its own)</span>
        <input name="summarizerModel" defaultValue={settings.summarizer?.model ?? ''} />
      </label>
      <p className="tg-note">
        After twenty messages a conversation is folded into a short memory so the history sent to
        the model stays small. Each summary is one model call.
      </p>
    </Section>
  );
}
