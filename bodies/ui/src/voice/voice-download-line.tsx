/**
 * The one status line under Settings' Voice select: Scout's voice is still downloading (one line
 * for every voice, since they share one model), with a thin bar, or the download failed and
 * Try again asks the brain once more. Hidden when idle, ready or when the brain cannot be asked.
 * VoiceDownloadLine.
 */
import { useCallback, useEffect, useState } from 'react';
import type { HostBridge } from '../host-bridge';
import type { VoiceDownload } from '../shapes';
import { themeTokens as t, typeCss } from '../theme/tokens';

export type VoiceDownloadHost = Pick<HostBridge, 'voiceDownload' | 'fetchVoice' | 'onBrainChanged'>;

export function VoiceDownloadLine({ host }: { host: VoiceDownloadHost }) {
  const [state, setState] = useState<VoiceDownload | null>(null);
  const { voiceDownload, onBrainChanged } = host;

  const refresh = useCallback(() => {
    voiceDownload().then(setState, () => setState(null));
  }, [voiceDownload]);

  useEffect(() => {
    refresh();
    return onBrainChanged((what) => {
      if (what === 'voice_download' || what === 'link') refresh();
    });
  }, [refresh, onBrainChanged]);

  if (state === null || state.status === 'idle' || state.status === 'ready') return null;
  const percent = Math.round(state.progress * 100);
  return (
    <div className="tg-vdl" aria-live="polite">
      <style>{VDL_CSS}</style>
      {state.status === 'downloading' ? (
        <>
          <p className="tg-vdl__text">
            {`Downloading Scout's voice… ${String(percent)}%. Using the computer's voice until then.`}
          </p>
          <div
            className="tg-vdl__bar"
            role="progressbar"
            aria-label="Scout's voice download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="tg-vdl__fill" style={{ width: `${String(percent)}%` }} />
          </div>
        </>
      ) : (
        <p className="tg-vdl__text">
          {"Scout couldn't download Scout's voice. The computer's voice is speaking for now. "}
          <button
            type="button"
            className="tg-vdl__retry"
            onClick={() => void host.fetchVoice(true)}
          >
            Try again
          </button>
        </p>
      )}
    </div>
  );
}

const VDL_CSS = `
.tg-vdl { margin-top: 8px; }
.tg-vdl__text { ${typeCss('small')}; margin: 0 0 6px; color: ${t.color.panelMuted}; }
.tg-vdl__bar { height: 4px; border-radius: ${t.radius.pill}px; background: ${t.color.panelTile}; overflow: hidden; }
.tg-vdl__fill { height: 100%; background: ${t.color.okDot}; }
.tg-vdl__retry { all: unset; cursor: pointer; font-weight: 600; text-decoration: underline; color: ${t.color.panelText}; }
`;
