/**
 * The commands that turn a spare machine into a Scout brain, per system, each with a copy
 * button. Contains ServerSetup. The commands match docs/brain/server.md.
 */

import { useState } from 'react';
import { CopyButton, ThreeWay } from '../controls';

const KEY_AND_SERVE = ['tagalong key set', 'tagalong serve --install-service'];

const SYSTEMS = [
  {
    name: 'Linux and macOS',
    commands: [
      'curl -LsSf https://raw.githubusercontent.com/nadeem4/tagalong/main/install/install.sh | sh',
      ...KEY_AND_SERVE,
    ],
  },
  {
    name: 'Windows',
    commands: [
      'irm https://raw.githubusercontent.com/nadeem4/tagalong/main/install/install.ps1 | iex',
      ...KEY_AND_SERVE,
    ],
  },
  {
    name: 'Docker',
    commands: [
      'docker run -d --name tagalong -v tagalong:/data -p 47323:47323 -e TAGALONG_PUBLIC_HOST=<server name or address> tagalong',
      'docker logs tagalong',
    ],
  },
] as const;

export function ServerSetup({ copyText }: { copyText: (text: string) => Promise<void> }) {
  const [system, setSystem] = useState<string>(SYSTEMS[0].name);
  const shown = SYSTEMS.find((entry) => entry.name === system) ?? SYSTEMS[0];
  return (
    <div className="pair-server">
      <ThreeWay
        label="System"
        value={system}
        options={SYSTEMS.map((entry) => ({ value: entry.name, label: entry.name }))}
        onChange={setSystem}
      />
      <ol className="pair-commands">
        {shown.commands.map((command) => (
          <li key={command}>
            <code className="pair-code">{command}</code>
            <CopyButton
              text={command}
              copy={copyText}
              label={`Copy ${command.split(' ').slice(0, 2).join(' ')}`}
            />
          </li>
        ))}
      </ol>
      <p className="wt-help">
        {system === 'Docker'
          ? 'The log ends with a pairing QR and link. Paste the link below.'
          : 'The last command prints a pairing QR and link in that terminal. Paste the link below. It works once, for 10 minutes.'}
      </p>
    </div>
  );
}
