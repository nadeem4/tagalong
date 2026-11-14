/**
 * Settings' Speech to text card: a graphics-card chip, a "While you talk" and a "When you finish"
 * select (both default to Auto), and a footer slot for the show-words switch. Picking saves at
 * once. The info icons and the footer are slots because Info lives in the desktop app. VoiceModelsField.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Select } from '../controls/select';
import type { HostBridge } from '../host-bridge';
import { finalOptions, liveOptions } from '../shapes';
import type { SttState } from '../shapes';
import { themeTokens as t, typeCss } from '../theme/tokens';

export type VoiceModelsHost = Pick<HostBridge, 'sttState' | 'setStt' | 'onBrainChanged'>;

type Outcome = { kind: 'saved' } | { kind: 'error'; text: string } | null;

export function VoiceModelsField({
  host,
  liveInfo,
  finalInfo,
  children,
}: {
  host: VoiceModelsHost;
  liveInfo?: ReactNode;
  finalInfo?: ReactNode;
  children?: ReactNode;
}) {
  const [state, setState] = useState<SttState | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const liveId = useId();
  const finalId = useId();
  const { sttState, onBrainChanged } = host;

  const refresh = useCallback(() => {
    sttState().then(setState, () => setState(null));
  }, [sttState]);

  useEffect(() => {
    refresh();
    return onBrainChanged((what) => {
      if (what === 'stt' || what === 'link') refresh();
    });
  }, [refresh, onBrainChanged]);

  async function pick(part: 'live' | 'final', value: string): Promise<void> {
    if (state === null || state[part] === value) return;
    try {
      await host.setStt({ [part]: value });
      setState((now) => (now === null ? now : { ...now, [part]: value }));
      setOutcome({ kind: 'saved' });
    } catch (error) {
      setOutcome({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <section className="tg-card tg-stt">
      <style>{STT_CSS}</style>
      <div className="tg-stt__head">
        <div>
          <h2 className="tg-stt__title">Speech to text</h2>
          <p className="tg-stt__lead">How Scout&apos;s brain writes down what you say.</p>
        </div>
        {state !== null && (
          <span className={`tg-stt__chip${state.gpu_name === null ? ' is-none' : ''}`}>
            <span className="tg-stt__dot" aria-hidden="true" />
            {state.gpu_name ?? 'No graphics card'}
          </span>
        )}
      </div>
      {state !== null && (
        <div className="tg-stt__grid">
          <div className="tg-stt__col">
            <div className="tg-stt__labelrow">
              <label htmlFor={liveId} className="tg-stt__label">
                While you talk
              </label>
              {liveInfo}
            </div>
            <Select
              id={liveId}
              value={state.live}
              onChange={(v) => void pick('live', v)}
              options={liveOptions(state)}
              invalid={outcome?.kind === 'error'}
            />
          </div>
          <div className="tg-stt__col">
            <div className="tg-stt__labelrow">
              <label htmlFor={finalId} className="tg-stt__label">
                When you finish
              </label>
              {finalInfo}
            </div>
            <Select
              id={finalId}
              value={state.final}
              onChange={(v) => void pick('final', v)}
              options={finalOptions(state)}
              invalid={outcome?.kind === 'error'}
            />
          </div>
        </div>
      )}
      <div className="tg-stt__msg" aria-live="polite">
        {outcome?.kind === 'saved' && (
          <span className="tg-stt__ok" role="status">
            Saved.
          </span>
        )}
        {outcome?.kind === 'error' && (
          <span className="tg-stt__err" role="alert">
            {outcome.text}
          </span>
        )}
      </div>
      {children !== undefined && <div className="tg-stt__foot">{children}</div>}
    </section>
  );
}

// Text sits on the type roles; the chip dot uses the green status token, grey when no card.
const STT_CSS = `
.tg-stt__head { display: flex; justify-content: space-between; align-items: flex-start; gap: ${t.space.lg}px; }
.tg-stt__title { ${typeCss('bodyLead')}; font-weight: 600; margin: 0; color: ${t.color.panelText}; }
.tg-stt__lead { ${typeCss('body')}; margin: 2px 0 0; color: ${t.color.panelMuted}; }
.tg-stt__chip {
  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 ${t.space.lg}px; flex: none;
  border-radius: ${t.radius.pill}px; background: ${t.color.panelTile}; color: ${t.color.panelText}; ${typeCss('small')};
}
.tg-stt__chip.is-none { color: ${t.color.panelMuted}; }
.tg-stt__dot { width: 8px; height: 8px; border-radius: 50%; background: ${t.color.okDot}; }
.tg-stt__chip.is-none .tg-stt__dot { background: ${t.color.panelMuted}; }
.tg-stt__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: ${t.space.lg}px 24px; margin-top: 16px; }
.tg-stt__col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.tg-stt__labelrow { display: flex; align-items: center; gap: 6px; }
.tg-stt__label { ${typeCss('body')}; font-weight: 600; color: ${t.color.panelText}; }
.tg-stt__msg { min-height: 20px; margin-top: 8px; ${typeCss('small')}; font-weight: 600; }
.tg-stt__ok { color: ${t.color.okInk}; }
.tg-stt__err { color: ${t.color.errInk}; }
.tg-stt__foot { margin-top: 8px; padding-top: 16px; border-top: 1px solid ${t.color.panelLine}; }
`;
