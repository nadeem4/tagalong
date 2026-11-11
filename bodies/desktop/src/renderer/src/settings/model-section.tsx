/**
 * Settings' "Scout's model" section: which AI model Scout thinks with. The selects and the
 * save-at-once pick are the shared ModelField; this adds the card and its lead line.
 */
import { ModelField, useHostBridge } from '@tagalong/ui';
import { Section } from './section';

export function ModelSection() {
  const bridge = useHostBridge();
  return (
    <Section id="model">
      <p className="tg-help">The AI model Scout thinks with, on your Anthropic key.</p>
      <ModelField host={bridge} />
    </Section>
  );
}
