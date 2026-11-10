/**
 * Settings' "Where Scout looks for apps" section: the two registries the brain searches (apps
 * over MCP, experts over ACP) with their addresses, read only. The brain reports them with its
 * setup overview; an old or offline brain gets one plain line.
 */
import { useEffect, useState } from 'react';
import { useHostBridge } from '@tagalong/ui';
import type { SetupOverview } from '@tagalong/ui/shapes';
import { Section } from './section';

type Sources = SetupOverview['sources'];

export function RegistriesView({ sources }: { sources: Sources }) {
  return (
    <Section id="registries">
      {sources === null ? (
        <p className="tg-help">Scout’s brain isn’t reporting its registries right now.</p>
      ) : (
        <ul className="tg-help">
          <li>
            Apps: {sources.apps.name} <code>{sources.apps.url}</code>
          </li>
          <li>
            Experts: {sources.experts.name} <code>{sources.experts.url}</code>
          </li>
        </ul>
      )}
    </Section>
  );
}

export function RegistriesSection() {
  const bridge = useHostBridge();
  const [sources, setSources] = useState<Sources>(null);
  useEffect(() => {
    // One read: a failure is the same plain line as an old brain.
    bridge.setupOverview().then(
      (overview) => setSources(overview.sources),
      () => setSources(null),
    );
  }, [bridge]);
  return <RegistriesView sources={sources} />;
}
