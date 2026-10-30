/**
 * Settings' How Scout thinks section: Scout's real brain (its own provider and model) with a
 * status chip. When Claude Code is not here, or is signed out and the person asks for it, a
 * service is picked and its key pasted; Save stores the key and moves Scout to that service.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Pet } from '@tagalong/protocol';
import type { ProviderChoice } from '../../../shared/ipc';
import type { ScoutBrain } from './brain';
import { Section } from './section';

/** The services Scout can think on with a key, in the order a person meets them. */
const KEYED = [
  { id: 'anthropic', hint: 'Claude through an API key' },
  { id: 'openrouter', hint: 'Hundreds of models, one key' },
] as const;

export function BrainSection({
  brain,
  providers,
  onCheckAgain,
  onSwitched,
}: {
  brain: ScoutBrain;
  providers: readonly ProviderChoice[];
  onCheckAgain: () => void;
  onSwitched: (pet: Pet, providerId: string) => void;
}) {
  const [picking, setPicking] = useState(false);

  if (brain.state === 'engine-down') {
    return (
      <Section id="brain">
        <div className="tg-alert tg-alert--err" role="status">
          <p className="tg-alert__title">Scout&apos;s engine didn&apos;t start</p>
          <p>
            Settings can still be changed. Sign-in status and model lists come back once it&apos;s
            running.
          </p>
        </div>
      </Section>
    );
  }

  if (brain.state === 'no-sign-in') {
    return (
      <Section id="brain">
        <div className="tg-alert tg-alert--warn">
          <p className="tg-alert__title">Scout needs a brain to think with</p>
          <p>
            Claude Code isn&apos;t on this computer. Install it and sign in, and Scout uses that
            with no key. Or pick a service and paste its key.
          </p>
        </div>
        <KeyPicker
          providers={providers}
          onSwitched={onSwitched}
          extra={
            <button type="button" className="tg-link" onClick={onCheckAgain}>
              I signed in to Claude Code, check again
            </button>
          }
        />
      </Section>
    );
  }

  const canFix = brain.state === 'signed-out' || brain.state === 'unknown';
  return (
    <Section id="brain">
      <div className="tg-scout">
        <div className="tg-scout__text">
          <p className="tg-scout__title">{brain.title}</p>
          {brain.help !== '' && <p className="tg-help">{brain.help}</p>}
        </div>
        {brain.chip !== null && (
          <span
            className={
              brain.chip.tone === 'plain' ? 'tg-chip' : `tg-chip tg-chip--${brain.chip.tone}`
            }
          >
            {brain.chip.tone === 'ok' && <Mark path="M5 12.5l4.5 4.5L19 7.5" />}
            {brain.chip.tone === 'warn' && <Mark path="M12 7v6M12 17h.01" />}
            {brain.chip.text}
          </span>
        )}
      </div>
      {canFix && (
        <div className="tg-actions">
          <button type="button" className="tg-btn-quiet" onClick={onCheckAgain}>
            Check again
          </button>
          <button
            type="button"
            className="tg-btn-quiet"
            aria-expanded={picking}
            onClick={() => setPicking((open) => !open)}
          >
            Use an API key instead
          </button>
        </div>
      )}
      {canFix && picking && <KeyPicker providers={providers} onSwitched={onSwitched} />}
    </Section>
  );
}

/** A small stroked icon for a chip. The chip's words carry the meaning; this only echoes it. */
function Mark({ path }: { path: string }) {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d={path} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Pick a keyed service, paste its key, Save: the key is stored and Scout moves to it. */
function KeyPicker({
  providers,
  onSwitched,
  extra,
}: {
  providers: readonly ProviderChoice[];
  onSwitched: (pet: Pet, providerId: string) => void;
  extra?: ReactNode;
}) {
  const services = KEYED.flatMap((service) => {
    const choice = providers.find((provider) => provider.id === service.id);
    return choice === undefined ? [] : [{ ...service, name: choice.label }];
  });
  const [picked, setPicked] = useState<string>(services[0]?.id ?? 'anthropic');
  const [key, setKey] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = services.find((service) => service.id === picked);
  const name = chosen?.name ?? picked;

  const save = async (): Promise<void> => {
    if (key.trim() === '') return setProblem(`Paste your ${name} key first.`);
    setBusy(true);
    setProblem(null);
    try {
      await window.tagalongHost.saveApiKey(picked, key.trim());
      const pet = await window.tagalongHost.switchScout(picked);
      setKey('');
      onSwitched(pet, picked);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tg-picker">
      <div className="tg-picker__services" role="group" aria-label="Service">
        {services.map((service) => (
          <button
            key={service.id}
            type="button"
            className="tg-picker__service"
            aria-pressed={service.id === picked}
            onClick={() => setPicked(service.id)}
          >
            <span className="tg-picker__name">{service.name}</span>
            <span className="tg-help">{service.hint}</span>
          </button>
        ))}
      </div>
      <label className="tg-narrow">
        <span>{name} API key</span>
        <input
          type="password"
          autoComplete="off"
          placeholder="Paste your key"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
      </label>
      <div className="tg-actions">
        <button type="button" className="tg-btn" disabled={busy} onClick={() => void save()}>
          Save
        </button>
        {extra}
      </div>
      {problem !== null && (
        <p className="tg-error" role="alert">
          {problem}
        </p>
      )}
      <p className="tg-help">
        Saving switches Scout to {name}. Keys are encrypted with the OS keychain and never shown
        again.
      </p>
    </div>
  );
}
