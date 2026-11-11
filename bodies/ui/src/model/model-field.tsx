/**
 * Settings' Scout's model: a disabled Provider select and a Model select that opens a list. The
 * list is a custom listbox, not a native select, because it draws a check on the current model
 * and a Default tag, which a native list cannot show. Picking saves at once. Contains ModelField.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { HostBridge } from '../host-bridge';
import type { ModelState } from '../shapes';
import { themeTokens as t } from '../theme/tokens';

export type ModelHost = Pick<HostBridge, 'modelState' | 'setModel' | 'onBrainChanged'>;

const PROVIDER_NAMES: Record<string, string> = { anthropic: 'Anthropic' };

type Outcome = { kind: 'saved' } | { kind: 'error'; text: string } | null;

export function ModelField({ host }: { host: ModelHost }) {
  const [state, setState] = useState<ModelState | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const listId = useId();
  const { modelState, onBrainChanged } = host;

  const refresh = useCallback(() => {
    modelState().then(setState, () => setState(null));
  }, [modelState]);

  useEffect(() => {
    refresh();
    return onBrainChanged((what) => {
      if (what === 'model' || what === 'link') refresh();
    });
  }, [refresh, onBrainChanged]);

  if (state === null) return null;
  const models = state.models;
  const currentIndex = Math.max(
    0,
    models.findIndex((m) => m.id === state.model),
  );
  const current = models[currentIndex];

  function openList(): void {
    setActive(currentIndex);
    setOutcome(null);
    setOpen(true);
  }

  async function pick(index: number): Promise<void> {
    setOpen(false);
    const chosen = models[index];
    if (chosen === undefined || chosen.id === state?.model) return;
    try {
      await host.setModel(chosen.id);
      setState((now) => (now === null ? now : { ...now, model: chosen.id }));
      setOutcome({ kind: 'saved' });
    } catch (error) {
      setOutcome({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!open) {
      if (
        event.key === 'Enter' ||
        event.key === ' ' ||
        (event.altKey && event.key === 'ArrowDown')
      ) {
        event.preventDefault();
        openList();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((i) => Math.min(models.length - 1, i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(models.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        void pick(active);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation(); // closes the list, not whatever window holds it
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  return (
    <div className="tg-model">
      <style>{MODEL_CSS}</style>
      <div className="tg-model__row">
        <div className="tg-model__text">
          <span className="tg-model__label">Provider</span>
          <span className="tg-model__note">More providers coming later</span>
        </div>
        <div className="tg-model__ctl">
          <div
            className="tg-model__sel"
            role="combobox"
            aria-label="Provider"
            aria-expanded="false"
            aria-disabled="true"
          >
            <span className="tg-model__value">
              <span className="tg-model__name">{PROVIDER_NAMES[state.provider] ?? state.provider}</span>
            </span>
            <Chevron />
          </div>
        </div>
      </div>
      <div className="tg-model__row">
        <div className="tg-model__text">
          <div className="tg-model__labelrow">
            <span className="tg-model__label">Model</span>
            {outcome?.kind === 'saved' && (
              <span className="tg-model__msg tg-model__msg--ok" role="status">
                <Check />
                Saved.
              </span>
            )}
            {outcome?.kind === 'error' && (
              <span className="tg-model__msg tg-model__msg--err" role="alert">
                {outcome.text}
              </span>
            )}
          </div>
          <span className="tg-model__note">
            Faster models cost less per reply, so your daily limit lasts longer. Applies from
            Scout&apos;s next reply.
          </span>
        </div>
        <div className="tg-model__ctl">
          <div
            className={`tg-model__sel tg-model__sel--live${open ? ' is-open' : ''}`}
            role="combobox"
            aria-label="Model"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={open ? `${listId}-${active}` : undefined}
            tabIndex={0}
            onClick={() => (open ? setOpen(false) : openList())}
            onKeyDown={onKeyDown}
            onBlur={() => setOpen(false)}
          >
            <span className="tg-model__value">
              <span className="tg-model__name">{current?.name}</span>
              <span className="tg-model__line">{current?.line}</span>
            </span>
            <Chevron />
          </div>
          {open && (
            <ul
              className="tg-model__list"
              id={listId}
              role="listbox"
              aria-label="Model"
              // Keep focus on the combobox while the pointer picks.
              onMouseDown={(event) => event.preventDefault()}
            >
              {models.map((m, index) => (
                <li
                  key={m.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={m.id === state.model}
                  className={index === active ? 'is-active' : undefined}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => void pick(index)}
                >
                  <span className="tg-model__opt">
                    <span className="tg-model__optname">
                      {m.name}
                      {m.id === state.default && <span className="tg-model__chip">Default</span>}
                    </span>
                    <span className="tg-model__optline">{m.line}</span>
                  </span>
                  {m.id === state.model ? <Tick /> : <span />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg className="tg-model__chev" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 6 8 10.5 12.5 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Tick() {
  return (
    <svg className="tg-model__tick" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="m4 8.4 2.6 2.6L12 5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Check() {
  return (
    <svg className="tg-model__check" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="m5.3 8.2 1.9 1.9 3.6-3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Sizes follow the type roles (body-lead 14/20, body 13/20, small 12/16, caption 11/14; 400/600).
const MODEL_CSS = `
.tg-model__row {
  display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 12px 32px; align-items: start;
  padding: 16px 0 2px; border-top: 1px solid ${t.color.panelLine};
}
.tg-model__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding-top: 8px; }
.tg-model__labelrow { display: flex; align-items: center; gap: 10px; }
.tg-model__label { font-size: 13px; line-height: 20px; font-weight: 600; color: ${t.color.panelText}; }
.tg-model__note { font-size: 13px; line-height: 20px; color: ${t.color.panelMuted}; max-width: 46ch; }
.tg-model__msg { display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 16px; font-weight: 600; }
.tg-model__msg--ok { color: ${t.color.okInk}; }
.tg-model__msg--err { color: ${t.color.errInk}; }
.tg-model__check { width: 16px; height: 16px; flex: none; }
.tg-model__ctl { position: relative; }
.tg-model__sel {
  position: relative; box-sizing: border-box; width: 100%; height: 36px; display: flex; align-items: center;
  gap: 8px; padding: 0 10px 0 12px; border: 1px solid ${t.color.keycapLine}; border-radius: 8px;
  background: #fff; box-shadow: 0 1px 1px rgba(18, 22, 43, 0.04); font-family: ${t.font.ui};
  font-size: 14px; line-height: 20px; color: ${t.color.panelText};
}
.tg-model__sel--live { cursor: pointer; }
.tg-model__sel--live:focus-visible { outline: 2px solid ${t.color.focusOnLight}; outline-offset: 2px; }
.tg-model__sel.is-open { border-color: ${t.color.panelText}; }
.tg-model__sel.is-open .tg-model__chev { transform: rotate(180deg); color: ${t.color.panelText}; }
.tg-model__sel[aria-disabled='true'] {
  background: #eef0f5; border-color: ${t.color.panelLine}; box-shadow: none; color: #6e7590; cursor: default;
}
.tg-model__sel[aria-disabled='true'] .tg-model__chev { color: #b4b9c9; }
.tg-model__value { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; white-space: nowrap; overflow: hidden; }
.tg-model__name { flex: none; }
.tg-model__line { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: ${t.color.panelMuted}; font-size: 13px; }
.tg-model__line::before { content: '\\00B7'; margin-right: 6px; }
.tg-model__chev { width: 16px; height: 16px; flex: none; color: ${t.color.panelMuted}; }
.tg-model__list {
  position: absolute; z-index: 2; top: 42px; left: 0; right: 0; list-style: none; margin: 0; padding: 4px;
  display: flex; flex-direction: column; gap: 2px; background: #fff; border: 1px solid ${t.color.panelLine};
  border-radius: 10px; box-shadow: 0 1px 2px rgba(18, 22, 43, 0.08), 0 12px 32px -8px rgba(18, 22, 43, 0.24);
}
.tg-model__list li {
  display: grid; grid-template-columns: minmax(0, 1fr) 16px; align-items: center; gap: 10px;
  min-height: 52px; padding: 8px 10px 8px 12px; border-radius: 7px; cursor: pointer;
}
.tg-model__list li.is-active { background: ${t.color.panelTile}; }
.tg-model__opt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tg-model__optname { display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 20px; font-weight: 600; color: ${t.color.panelText}; }
.tg-model__optline { font-size: 12px; line-height: 16px; color: ${t.color.panelMuted}; }
.tg-model__tick { width: 16px; height: 16px; color: ${t.color.panelText}; }
.tg-model__chip {
  display: inline-flex; align-items: center; height: 18px; padding: 0 7px; border-radius: 9px; flex: none;
  background: ${t.color.panelTile}; color: ${t.color.chipFreeInk}; font-size: 11px; line-height: 14px; font-weight: 600;
}
.tg-model__list li.is-active .tg-model__chip { background: #fff; }
`;
