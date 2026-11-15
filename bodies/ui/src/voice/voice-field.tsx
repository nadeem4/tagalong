/**
 * The "Scout's voice" card shared by Settings and the first-run tour: Auto first, then the voices
 * that run on any PC, each with a play button and its state. Picking saves at once; the brain
 * starts the download of a voice that is not installed and the chosen voice's download line
 * shows it. VoiceField.
 */
import { useCallback, useEffect, useState } from 'react';
import type { HostBridge } from '../host-bridge';
import { formatSize } from '../shapes';
import type { TtsState, TtsVoiceRow } from '../shapes';
import { themeTokens as t, typeCss } from '../theme/tokens';
import { VoiceDownloadLine } from './voice-download-line';

export type VoiceFieldHost = Pick<
  HostBridge,
  'ttsState' | 'setTts' | 'playVoiceSample' | 'onBrainChanged' | 'voiceDownload' | 'fetchVoice'
>;

function stateLabel(voice: TtsVoiceRow, state: TtsState): string {
  const { download } = state;
  if (download.voice === voice.id && download.status === 'downloading') {
    return `Downloading ${String(Math.round(download.progress * 100))}%`;
  }
  if (!voice.installed) return 'Download';
  return state.chosen === voice.id ? 'In use' : '';
}

export function VoiceField({ host, speed }: { host: VoiceFieldHost; speed: number }) {
  const [state, setState] = useState<TtsState | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { ttsState, onBrainChanged } = host;

  const refresh = useCallback(() => {
    ttsState().then(setState, () => setState(null));
  }, [ttsState]);

  useEffect(() => {
    refresh();
    return onBrainChanged((what) => {
      if (what === 'tts' || what === 'voice_download' || what === 'link') refresh();
    });
  }, [refresh, onBrainChanged]);

  async function pick(id: string): Promise<void> {
    if (state === null || state.chosen === id) return;
    setNote(null);
    try {
      await host.setTts(id);
      setState((now) => (now === null ? now : { ...now, chosen: id }));
      refresh();
    } catch {
      setNote("Couldn't change the voice.");
    }
  }

  async function play(id: string): Promise<void> {
    setNote(null);
    setPlaying(id);
    try {
      await host.playVoiceSample(id, speed);
    } catch {
      setNote("Couldn't play that sample.");
    } finally {
      setPlaying(null);
    }
  }

  const resolvedLabel = state?.voices.find((v) => v.id === state.resolved)?.label;

  return (
    <section className="tg-card tg-vf">
      <style>{VF_CSS}</style>
      <h2 className="tg-vf__title">Scout&apos;s voice</h2>
      <p className="tg-vf__lead">How Scout sounds when it talks to you.</p>
      {state === null ? (
        <p className="tg-vf__loading">Loading voices…</p>
      ) : (
        <div role="radiogroup" aria-label="Scout's voice">
          <div className="tg-vf__row">
            <button
              type="button"
              role="radio"
              aria-checked={state.chosen === 'auto'}
              className="tg-vf__pick"
              onClick={() => void pick('auto')}
            >
              <span className="tg-vf__text">
                <span className="tg-vf__name">Auto (recommended)</span>
                {resolvedLabel !== undefined && (
                  <span className="tg-vf__desc">{`Uses ${resolvedLabel}`}</span>
                )}
              </span>
              <span className="tg-vf__state">{state.chosen === 'auto' ? 'In use' : ''}</span>
            </button>
          </div>
          <h3 className="tg-vf__group">Runs on any PC</h3>
          {state.voices.map((voice) => (
            <div className="tg-vf__row" key={voice.id}>
              <button
                type="button"
                role="radio"
                aria-checked={state.chosen === voice.id}
                className="tg-vf__pick"
                onClick={() => void pick(voice.id)}
              >
                <span className="tg-vf__text">
                  <span className="tg-vf__name">{voice.label}</span>
                  <span className="tg-vf__desc">{voice.descriptor}</span>
                </span>
                <span className="tg-vf__size">{formatSize(voice.size_mb)}</span>
                <span className="tg-vf__state">{stateLabel(voice, state)}</span>
              </button>
              {voice.sample && (
                <button
                  type="button"
                  className="tg-vf__play"
                  aria-label={`Play ${voice.label}`}
                  disabled={playing === voice.id}
                  onClick={() => void play(voice.id)}
                >
                  {playing === voice.id ? '…' : '▶'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <VoiceDownloadLine host={host} />
      <div className="tg-vf__msg" aria-live="polite">
        {note !== null && (
          <span className="tg-vf__err" role="alert">
            {note}
          </span>
        )}
      </div>
    </section>
  );
}

// Same card rhythm as Speech to text; rows are quiet tiles, the picked one gets a solid ring.
const VF_CSS = `
.tg-vf__title { ${typeCss('bodyLead')}; font-weight: 600; margin: 0; color: ${t.color.panelText}; }
.tg-vf__lead { ${typeCss('body')}; margin: 2px 0 0; color: ${t.color.panelMuted}; }
.tg-vf__loading { ${typeCss('body')}; margin: 16px 0 0; color: ${t.color.panelMuted}; }
.tg-vf__group { ${typeCss('small')}; font-weight: 600; margin: 16px 0 6px; color: ${t.color.panelMuted}; }
.tg-vf [role='radiogroup'] { margin-top: 16px; }
.tg-vf__row { display: flex; align-items: stretch; gap: 6px; margin-top: 6px; }
.tg-vf__pick {
  all: unset; box-sizing: border-box; flex: 1; min-width: 0; display: flex; align-items: center; gap: ${t.space.lg}px;
  padding: 10px ${t.space.lg}px; border-radius: ${t.radius.sm}px; cursor: pointer;
  background: ${t.color.panelTile}; border: 1px solid transparent; color: ${t.color.panelText};
}
.tg-vf__pick[aria-checked='true'] { border-color: ${t.color.panelText}; }
.tg-vf__pick:focus-visible, .tg-vf__play:focus-visible { outline: ${t.size.focusRing}px solid ${t.color.panelText}; outline-offset: 2px; }
.tg-vf__text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.tg-vf__name { ${typeCss('body')}; font-weight: 600; }
.tg-vf__desc { ${typeCss('small')}; color: ${t.color.panelMuted}; }
.tg-vf__size { ${typeCss('small')}; color: ${t.color.panelMuted}; flex: none; }
.tg-vf__state { ${typeCss('small')}; font-weight: 600; flex: none; min-width: 84px; text-align: right; }
.tg-vf__play {
  all: unset; box-sizing: border-box; flex: none; width: 40px; display: flex; align-items: center; justify-content: center;
  border-radius: ${t.radius.sm}px; cursor: pointer; background: ${t.color.panelTile}; color: ${t.color.panelText};
}
.tg-vf__play:disabled { cursor: default; color: ${t.color.panelMuted}; }
.tg-vf__msg { min-height: 20px; margin-top: 8px; ${typeCss('small')}; font-weight: 600; }
.tg-vf__err { color: ${t.color.errInk}; }
`;
