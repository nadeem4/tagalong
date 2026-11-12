/**
 * The get-to-know-me form: one input per source from what it needs (a GitHub username, the
 * LinkedIn PDF), and while a run goes, one progress row per source. Contains RunForm.
 */

import { useId, useState } from 'react';
import { Button } from '../controls/button';
import type { KnowMeInput, KnowMeStatus, KnowSourceInfo } from '../shapes';
import { KNOW_ME_CSS } from './know-me-styles';

const PDF_MAX_BYTES = 10 * 1024 * 1024;
const TOO_BIG = 'That PDF is over 10 MB. Pick a smaller one.';

/** The file as base64, without the data-URL prefix the reader adds. */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

/** A row is named by the brain's source name; the person reads the source's label. */
function rowText(
  name: string,
  state: KnowMeStatus['sources'][number]['state'],
  sources: KnowSourceInfo[],
): string {
  if (name === 'portrait') {
    return {
      waiting: 'Portrait: waiting',
      reading: 'Writing the portrait…',
      done: 'Portrait written',
      failed: 'No portrait written',
    }[state];
  }
  const label = sources.find((s) => s.name === name)?.label ?? name;
  return {
    waiting: `${label}: waiting`,
    reading: `Reading ${label}…`,
    done: `${label}: done`,
    failed: `${label}: not read`,
  }[state];
}

interface RunFormProps {
  sources: KnowSourceInfo[];
  onStart(input: KnowMeInput): void;
  running: boolean;
  status?: KnowMeStatus | null;
  /** A plain sentence from a refused start. */
  error?: string | null;
}

export function RunForm({ sources, onStart, running, status = null, error = null }: RunFormProps) {
  const id = useId();
  const [github, setGithub] = useState('');
  const [pdf, setPdf] = useState<{ name: string; data: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  if (running) {
    return (
      <div className="know">
        <style>{KNOW_ME_CSS}</style>
        <ul className="know__progress" aria-label="Progress">
          {(
            status?.sources ?? sources.map((s) => ({ name: s.name, state: 'waiting' as const }))
          ).map((row) => (
            <li key={row.name} className="know__row" data-state={row.state}>
              <span className="know__dot" aria-hidden="true" />
              <span>{rowText(row.name, row.state, sources)}</span>
              {'gap' in row && row.gap && <span className="know__row-gap">{row.gap}</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const pick = (file: File | undefined): void => {
    setPdf(null);
    setFileError(null);
    if (file === undefined) return;
    if (file.size > PDF_MAX_BYTES) {
      setFileError(TOO_BIG);
      return;
    }
    readBase64(file).then(
      (data) => setPdf({ name: file.name, data }),
      (e: unknown) => setFileError(e instanceof Error ? e.message : 'Could not read that file.'),
    );
  };

  const canStart = github.trim() !== '' || pdf !== null;
  const start = (): void => {
    onStart({
      ...(github.trim() !== '' ? { github: github.trim() } : {}),
      ...(pdf !== null ? { pdf } : {}),
    });
  };

  return (
    <div className="know">
      <style>{KNOW_ME_CSS}</style>
      <div className="know__form">
        {sources.map((source) => {
          const field = `${id}-${source.name}`;
          if (source.needs === 'username') {
            return (
              <div key={source.name} className="know__field">
                <label className="know__label" htmlFor={field}>
                  {source.label}
                </label>
                <input
                  id={field}
                  type="text"
                  value={github}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setGithub(e.target.value)}
                />
              </div>
            );
          }
          if (source.needs === 'file') {
            return (
              <div key={source.name} className="know__field">
                <label className="know__label" htmlFor={field}>
                  {source.label}
                </label>
                <input
                  id={field}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={(e) => pick(e.target.files?.[0])}
                />
                {pdf !== null && <p className="know__hint">{pdf.name}</p>}
                <p className="know__hint">On your LinkedIn profile: More, then Save to PDF.</p>
                {fileError !== null && (
                  <p className="know__error" role="alert">
                    {fileError}
                  </p>
                )}
              </div>
            );
          }
          return null;
        })}
        {error !== null && (
          <p className="know__error" role="alert">
            {error}
          </p>
        )}
        <div className="know__actions">
          <Button variant="primary" disabled={!canStart} onClick={start}>
            Get to know me
          </Button>
        </div>
      </div>
    </div>
  );
}
