/**
 * Walkthrough step 1: where Scout's brain lives. This computer (optionally kept on for other
 * devices), another computer found nearby or paired by link, or a server set up from commands.
 * Tells the shell whether Next must wait for a pairing. Contains StepBrain.
 */

import { useEffect, useState } from 'react';
import { Toggle, ThreeWay } from '../controls';
import type { FoundBrain } from '../shapes/pairing';
import { BrainDiagram } from '../pair/brain-diagram';
import { FoundBrains } from '../pair/found-brains';
import { PairLinkForm } from '../pair/pair-link-form';
import { ServerSetup } from '../pair/server-setup';
import { useStepSave } from './use-step-save';
import type { WalkthroughHost } from './walkthrough-host';

type Place = 'this' | 'other' | 'server';

const PLACES: readonly { id: Place; title: string; detail: string }[] = [
  {
    id: 'this',
    title: 'On this computer',
    detail: 'Everything stays on this PC. The simplest way to start.',
  },
  {
    id: 'other',
    title: 'On another computer',
    detail: 'Scout already lives on a PC you own. Pair this one to it.',
  },
  {
    id: 'server',
    title: 'On a server I’ll set up',
    detail: 'An always-on machine or a cloud server. One command installs it, then you pair.',
  },
];

type Host = Pick<
  WalkthroughHost,
  'discoverBrains' | 'pairWithLink' | 'installBrainService' | 'copyText'
>;

export function StepBrain({
  host,
  onBlock,
  onShare,
  onPaired,
}: {
  host: Host;
  /** Called with whether Next must wait: another computer is chosen and nothing is paired yet. */
  onBlock: (blocked: boolean) => void;
  /** Called with whether this PC's brain is set to be kept on for other devices. */
  onShare: (shared: boolean) => void;
  /** Called with the other computer's name once this PC is paired with its brain. */
  onPaired: (name: string) => void;
}) {
  const [place, setPlace] = useState<Place>('this');
  const [keepOn, setKeepOn] = useState(false);
  const [found, setFound] = useState<FoundBrain[]>([]);
  const [picked, setPicked] = useState<FoundBrain | null>(null);
  const [pairedWith, setPairedWith] = useState<string | null>(null);

  const { discoverBrains } = host;
  useEffect(() => {
    if (place !== 'other') return;
    discoverBrains().then(setFound, () => setFound([]));
  }, [place, discoverBrains]);

  const blocked = place === 'other' && pairedWith === null;
  useEffect(() => onBlock(blocked), [blocked, onBlock]);

  const shared = place === 'this' && keepOn;
  useEffect(() => onShare(shared), [shared, onShare]);

  useStepSave(async () => {
    if (place !== 'this' || !keepOn) return;
    const outcome = await host.installBrainService();
    if (!outcome.ok) throw new Error(outcome.detail);
  });

  return (
    <section>
      <span className="wt-label">Your brain</span>
      <h1>Where does Scout’s brain live?</h1>
      <p className="wt-lead">
        The brain is the part of Scout that thinks, remembers and runs your jobs. This computer can
        always talk to it, wherever it lives.
      </p>
      <div className="pair-paths">
        <ThreeWay
          cards
          label="Where Scout’s brain lives"
          value={place}
          options={PLACES.map(({ id, title, detail }) => ({
            value: id,
            label: title,
            detail,
            icon: <BrainDiagram place={id} />,
          }))}
          onChange={(next) => {
            setPlace(next as Place);
            setPairedWith(null);
            setPicked(null);
          }}
        />
      </div>

      {place === 'this' && (
        <div className="pair-keep">
          <span id="pair-keep-text">
            <strong>Keep it on for my other devices</strong>
            <span className="pair-meta">
              Starts the brain when you sign in and lets your own devices reach it over the network.
              You can pair them at the end.
            </span>
          </span>
          <Toggle
            checked={keepOn}
            onChange={setKeepOn}
            label="Keep it on for my other devices"
            describedBy="pair-keep-text"
          />
        </div>
      )}

      {place === 'other' && pairedWith === null && (
        <FoundBrains brains={found} onPick={setPicked} />
      )}
      {place === 'server' && pairedWith === null && <ServerSetup copyText={host.copyText} />}
      {place !== 'this' && pairedWith === null && (
        <PairLinkForm
          key={picked?.addr ?? 'none'}
          name={picked?.name ?? null}
          pair={host.pairWithLink}
          onPaired={(name) => {
            setPairedWith(name);
            onPaired(name);
          }}
        />
      )}
      {pairedWith !== null && (
        <p className="pair-alert pair-alert--ok" role="status">
          Paired with {pairedWith}
          <span className="pair-meta">
            Scout on this PC now uses that brain. Its voice and API key live there.
          </span>
        </p>
      )}
    </section>
  );
}
