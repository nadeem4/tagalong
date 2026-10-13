import { useState } from 'react';
import type { Settings } from '@tagalong/protocol';
import type { ProviderChoice } from '../../../shared/ipc';
import { Info, Tip, useInvalid } from './section';

/**
 * One row per service that takes a key: whether one is stored, a box to add or replace it,
 * its base URL, and Remove. A stored key is never read back into the form (`hasKey` is all
 * main will say), so a saved secret cannot be recovered from a window someone left open.
 * Every base URL box stays in the form even while its row is closed, since the overrides
 * are sent whole and a missing box would read as "back to the default".
 */
export function KeysSection({
  providers,
  settings,
  keys,
  onKeysChange,
  onRemove,
}: {
  providers: readonly ProviderChoice[];
  settings: Settings;
  keys: Record<string, string>;
  onKeysChange: (keys: Record<string, string>) => void;
  onRemove: (providerId: string) => void;
}) {
  const [adding, setAdding] = useState<ReadonlySet<string>>(new Set());
  const keyed = providers.filter((choice) => choice.needsKey);
  return (
    <div className="tg-group">
      <div className="tg-titlerow">
        <h3 className="tg-sub">API keys</h3>
        <Info tip="keys" label="About API keys" />
      </div>
      <p className="tg-help">Only needed for a service other than your Claude sign-in.</p>
      <Tip tip="keys">
        A key lets Scout, or summaries, use that service instead of your sign-in. Keys are encrypted
        with the OS keychain and never shown again; type a new one to replace it. Base URL is for
        pointing a service somewhere else, such as a company proxy. Leave it blank unless you know
        you need it.
      </Tip>
      <ul className="tg-keys" aria-label="API keys">
        {keyed.map((choice) => (
          <KeyRow
            key={choice.id}
            choice={choice}
            baseUrl={settings.providerBaseUrls[choice.id] ?? ''}
            open={choice.hasKey || adding.has(choice.id)}
            typed={keys[choice.id] ?? ''}
            onType={(value) => onKeysChange({ ...keys, [choice.id]: value })}
            onAdd={() => setAdding(new Set([...adding, choice.id]))}
            onRemove={() => onRemove(choice.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function KeyRow({
  choice,
  baseUrl,
  open,
  typed,
  onType,
  onAdd,
  onRemove,
}: {
  choice: ProviderChoice;
  baseUrl: string;
  open: boolean;
  typed: string;
  onType: (value: string) => void;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const urlField = `baseUrl:${choice.id}`;
  const url = useInvalid(urlField);
  // A refused base URL has to be visible, so its row opens.
  const shown = open || url.message !== null || baseUrl !== '';
  return (
    <li className="tg-keys__row">
      <div className="tg-keys__head">
        <span className="tg-keys__name">{choice.label}</span>
        {choice.hasKey ? (
          <span className="tg-chip tg-chip--ok">Key stored</span>
        ) : (
          <span className="tg-keys__none">No key</span>
        )}
        {choice.hasKey ? (
          <button type="button" className="tg-btn-quiet" onClick={onRemove}>
            Remove key<span className="tg-sr"> for {choice.label}</span>
          </button>
        ) : (
          !shown && (
            <button type="button" className="tg-btn-quiet" onClick={onAdd}>
              Add key<span className="tg-sr"> for {choice.label}</span>
            </button>
          )
        )}
      </div>
      <div className="tg-grid" hidden={!shown}>
        <label>
          <span>
            {choice.hasKey ? 'Replace key' : 'Key'}
            <span className="tg-sr"> for {choice.label}</span>
          </span>
          <input
            type="password"
            name={`key:${choice.id}`}
            autoComplete="off"
            placeholder={choice.hasKey ? 'Type a new key to replace it' : 'Paste your key'}
            value={typed}
            onChange={(event) => onType(event.target.value)}
          />
        </label>
        {choice.defaultBaseUrl !== undefined && (
          <div>
            <label htmlFor={url.props.id}>
              <span>
                Base URL (blank for the default)
                <span className="tg-sr"> for {choice.label}</span>
              </span>
              <input
                name={urlField}
                defaultValue={baseUrl}
                placeholder={choice.defaultBaseUrl}
                {...url.props}
              />
            </label>
            {url.message}
          </div>
        )}
      </div>
    </li>
  );
}
