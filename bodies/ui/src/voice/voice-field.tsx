/**
 * The "Scout's voice" card shared by Settings and the first-run tour: Auto first, then the voices
 * that run on any PC, each with a play button and its state. Picking saves at once; the brain
 * starts the download of a voice that is not installed and the chosen voice's download line
 * shows it. VoiceField.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostBridge } from '../host-bridge';
import { Icon } from '../icons';
import { formatSize } from '../shapes';
import type { TtsState, TtsVoiceRow } from '../shapes';
import { themeTokens as t, typeCss } from '../theme/tokens';
import { VoiceDownloadLine } from './voice-download-line';

export type VoiceFieldHost = Pick<
  HostBridge,
  'ttsState' | 'setTts' | 'playVoiceSample' | 'onBrainChanged' | 'voiceDownload' | 'fetchVoice'
>;

const ENGINES: Record<string, string> = {
  piper: 'Piper',
  kokoro: 'Kokoro',
  supertonic: 'Supertonic',
};

// In use is the voice Scout speaks with now: the chosen one, or what Auto resolves to.
function stateLabel(voice: TtsVoiceRow, state: TtsState): string {
  const { download } = state;
  if (download.voice === voice.id && download.status === 'downloading') {
    return `Downloading ${String(Math.round(download.progress * 100))}%`;
  }
  if (!voice.installed) return 'Download';
  return state.resolved === voice.id ? 'In use' : 'Downloaded';
}

export function VoiceField({
  host,
  speed,
  title = "Scout's voice",
}: {
  host: VoiceFieldHost;
  speed: number;
  title?: string;
}) {
  const [state, setState] = useState<TtsState | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { ttsState, voiceDownload, onBrainChanged } = host;
  // Answers can arrive out of order (the full state hashes files off-thread), so only the
  // newest request may write; an older one is dropped.
  const latest = useRef(0);

  const refresh = useCallback(() => {
    latest.current += 1;
    const mine = latest.current;
    ttsState().then(
      (next) => {
        if (mine === latest.current) setState(next);
      },
      () => {
        if (mine === latest.current) setState(null);
      },
    );
  }, [ttsState]);

  useEffect(() => {
    refresh();
    return onBrainChanged((what) => {
      if (what === 'tts' || what === 'link') {
        refresh();
      } else if (what === 'voice_download') {
        // A download reports every couple of percent: only its progress is read, and the full
        // state again when it ends (a voice just became installed, or failed).
        voiceDownload().then(
          (download) => {
            if (download.status === 'ready' || download.status === 'failed') {
              refresh();
            } else {
              setState((now) =>
                now === null ? now : { ...now, download: { ...now.download, ...download } },
              );
            }
          },
          () => {},
        );
      }
    });
  }, [refresh, voiceDownload, onBrainChanged]);

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
      setPlaying((now) => (now === id ? null : now));
    }
  }

  const resolvedLabel = state?.voices.find((v) => v.id === state.resolved)?.label;

  return (
    <section className="tg-card tg-vf">
      <style>{VF_CSS}</style>
      <h2 className="tg-vf__title">{title}</h2>
      <p className="tg-vf__lead">Press play to hear a voice before you download it.</p>
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
              <span className="tg-vf__radio" aria-hidden="true">
                {state.chosen === 'auto' && <span className="tg-vf__dot" />}
              </span>
              <span className="tg-vf__text">
                <span className="tg-vf__top">
                  <span className="tg-vf__name">Auto</span>
                  <span className="tg-vf__rec">Recommended</span>
                </span>
                <span className="tg-vf__desc">
                  {resolvedLabel === undefined
                    ? 'Uses the best voice this PC can run.'
                    : `Uses the best voice this PC can run. Right now: ${resolvedLabel}.`}
                </span>
              </span>
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
                <span className="tg-vf__radio" aria-hidden="true">
                  {state.chosen === voice.id && <span className="tg-vf__dot" />}
                </span>
                <span className="tg-vf__gap" aria-hidden="true" />
                <span className="tg-vf__text">
                  <span className="tg-vf__top">
                    <span className="tg-vf__name">{voice.label}</span>
                    <span className="tg-vf__engine">{ENGINES[voice.engine] ?? voice.engine}</span>
                  </span>
                  <span className="tg-vf__desc">{voice.descriptor}</span>
                </span>
                <span className="tg-vf__size">{formatSize(voice.size_mb)}</span>
                <span
                  className={`tg-vf__state${state.resolved === voice.id && voice.installed ? ' is-use' : ''}`}
                >
                  {stateLabel(voice, state)}
                </span>
              </button>
              {voice.sample && (
                <button
                  type="button"
                  className={`tg-vf__play${playing === voice.id ? ' is-on' : ''}`}
                  aria-label={`Play ${voice.label}`}
                  disabled={playing !== null}
                  onClick={() => void play(voice.id)}
                >
                  <Icon name="play" />
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

// Rows are flat, divided by hairlines; the picked row gets the panel tint and a filled radio.
const VF_CSS = `
/* Inside Settings' panel the section is already a card: drop this one's own box. */
.tg-panel .tg-vf { border: 0; background: none; padding: 0; }
.tg-vf__title { ${typeCss('bodyLead')}; font-weight: 600; margin: 0; color: ${t.color.panelText}; }
.tg-vf__lead { ${typeCss('body')}; margin: 2px 0 0; color: ${t.color.panelMuted}; }
.tg-vf__loading { ${typeCss('body')}; margin: 16px 0 0; color: ${t.color.panelMuted}; }
.tg-vf__group { ${typeCss('caption')}; letter-spacing: .04em; text-transform: uppercase; margin: 20px 0 4px; color: ${t.color.panelMuted}; }
.tg-vf [role='radiogroup'] { margin-top: 16px; }
.tg-vf__row { position: relative; display: flex; align-items: stretch; }
.tg-vf__pick {
  all: unset; box-sizing: border-box; flex: 1; min-width: 0; min-height: 60px; display: flex; align-items: center; gap: ${t.space.lg}px;
  padding: ${t.space.lg}px; cursor: pointer; border-top: 1px solid ${t.color.panelLine}; color: ${t.color.panelText};
}
.tg-vf__row:first-child .tg-vf__pick { border-top: 0; border-radius: ${t.radius.sm}px; }
.tg-vf__pick:hover, .tg-vf__pick[aria-checked='true'] { background: ${t.color.panel}; }
.tg-vf__pick:focus-visible, .tg-vf__play:focus-visible { outline: ${t.size.focusRing}px solid ${t.color.panelText}; outline-offset: -2px; }
.tg-vf__radio {
  flex: none; width: 18px; height: 18px; box-sizing: border-box; border-radius: 50%; display: grid; place-items: center;
  border: 1.5px solid ${t.color.panelMuted};
}
.tg-vf__pick[aria-checked='true'] .tg-vf__radio { border-color: ${t.color.panelText}; }
.tg-vf__dot { width: 8px; height: 8px; border-radius: 50%; background: ${t.color.panelText}; }
.tg-vf__gap { flex: none; width: 32px; }
.tg-vf__text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.tg-vf__top { display: flex; align-items: center; gap: ${t.space.md}px; flex-wrap: wrap; }
.tg-vf__name { ${typeCss('bodyLead')}; font-weight: 600; }
.tg-vf__engine { ${typeCss('small')}; color: ${t.color.panelMuted}; }
.tg-vf__rec {
  height: 18px; padding: 0 ${t.space.md}px; border-radius: ${t.radius.pill}px; background: ${t.color.recFill};
  color: ${t.color.link}; ${typeCss('caption')}; line-height: 18px;
}
.tg-vf__desc { ${typeCss('body')}; color: ${t.color.panelMuted}; }
.tg-vf__size { ${typeCss('small')}; color: ${t.color.panelMuted}; flex: none; width: 76px; text-align: right; }
.tg-vf__state { ${typeCss('small')}; flex: none; width: 132px; text-align: right; color: ${t.color.panelMuted}; }
.tg-vf__state.is-use { font-weight: 600; color: ${t.color.okInk}; }
.tg-vf__play {
  all: unset; box-sizing: border-box; position: absolute; left: 42px; top: 50%; transform: translateY(-50%);
  width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; cursor: pointer;
  border: 1px solid ${t.color.panelLine}; background: ${t.color.card}; color: ${t.color.panelText};
}
.tg-vf__play:hover { border-color: ${t.color.panelMuted}; }
.tg-vf__play.is-on { background: ${t.color.gold}; border-color: ${t.color.gold}; }
.tg-vf__play:disabled { cursor: default; }
/* A small window (the tour at 150 percent scaling) narrows the size and state columns so a row never forces a sideways scroll. */
@media (max-width: 760px) {
  .tg-vf__size { width: 52px; }
  .tg-vf__state { width: 84px; }
  .tg-vf__pick { gap: ${t.space.md}px; }
}
.tg-vf__msg { min-height: 20px; margin-top: 8px; ${typeCss('small')}; font-weight: 600; }
.tg-vf__err { color: ${t.color.errInk}; }
`;
