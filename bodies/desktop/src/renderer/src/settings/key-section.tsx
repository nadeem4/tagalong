/**
 * Settings' "Anthropic key" section: change the key Scout thinks with, and the daily spend limit.
 * Both fields are the shared ones from @tagalong/ui; the host calls come from the bridge, and
 * the key goes to the brain once and is never kept here.
 */
import { KeyField, LimitField, useHostBridge, useKeyStatus } from '@tagalong/ui';
import { Section } from './section';

export function KeySection() {
  const bridge = useHostBridge();
  const { status } = useKeyStatus(bridge);
  return (
    <Section id="key">
      <p className="tg-help">
        Scout thinks with Claude, through your own Anthropic account. Anthropic bills this key for
        what Scout uses, up to your daily limit.
      </p>
      <KeyField host={bridge} />
      {status !== null && status !== 'offline' && (
        <LimitField host={bridge} limitUsd={status.dailyLimitUsd} />
      )}
    </Section>
  );
}
