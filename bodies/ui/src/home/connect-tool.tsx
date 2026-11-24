/**
 * "Connect another AI tool": a dialog over Devices. Pick Claude Code, Codex or Cursor, then
 * either Scout sets it up on this PC (working, connected or failed), or it shows the steps to
 * type, with the pairing link hidden until asked. Contains ConnectToolDialog.
 */
import { useEffect, useState } from 'react';
import { Button, CopyButton, Toggle } from '../controls';
import type { HostBridge } from '../host-bridge';
import { Icon } from '../icons';
import { PAIR_CSS } from '../pair/pair-styles';
import { AI_TOOLS, howToLines } from '../shapes';
import type { AiToolId, AiToolLink } from '../shapes';
import { themeTokens as t, themedColor, typeCss } from '../theme/tokens';
import { DeviceIcon } from './device-icons';

const CSS = `
.ct-tools { display: grid; grid-template-columns: repeat(3, 1fr); gap: ${t.space.md}px; }
.ct-tool { display: flex; flex-direction: column; align-items: center; gap: ${t.space.sm}px; padding: ${t.space.lg}px; border-radius: ${t.radius.card}px; border: 1px solid ${themedColor.panelLine}; background: ${themedColor.controlFill}; color: ${themedColor.panelText}; font: inherit; cursor: pointer; }
.ct-tool[aria-pressed='true'] { border-color: ${t.color.gold}; box-shadow: inset 0 0 0 1px ${t.color.gold}; }
.ct-tool:focus-visible { outline: 2px solid ${t.color.gold}; outline-offset: 2px; }
.ct-ways { display: grid; grid-template-columns: 1fr 1fr; gap: ${t.space.md}px; }
.ct-way { display: flex; flex-direction: column; align-items: flex-start; gap: ${t.space.sm}px; padding: ${t.space.lg}px; border-radius: ${t.radius.card}px; border: 1px solid ${themedColor.panelLine}; }
.ct-way h3 { margin: 0; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; }
.ct-way p, .ct-lead { margin: 0; ${typeCss('small')}; color: ${themedColor.panelMuted}; }
.ct-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${t.space.lg}px; }
.ct-steps li { display: flex; flex-direction: column; gap: 2px; }
.ct-steps strong { ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; }
.ct-file { font-family: ${t.font.mono}; ${typeCss('small')}; color: ${themedColor.panelMuted}; overflow-wrap: anywhere; }
.ct-facts { display: grid; grid-template-columns: max-content 1fr; gap: ${t.space.sm}px ${t.space.lg}px; margin: 0; ${typeCss('small')}; }
.ct-facts dt { color: ${themedColor.panelMuted}; }
.ct-facts dd { margin: 0; }
.ct-code { display: flex; align-items: flex-start; gap: ${t.space.sm}px; }
.ct-code pre { flex: 1; min-width: 0; margin: 0; padding: ${t.space.md}px ${t.space.lg}px; border-radius: ${t.radius.sm}px; background: ${t.color.page}; color: ${t.color.textSoft}; border: 1px solid ${t.color.fieldLine}; font-family: ${t.font.mono}; ${typeCss('small')}; white-space: pre-wrap; overflow-wrap: anywhere; user-select: all; }
.ct-code__side { display: flex; flex-direction: column; gap: ${t.space.sm}px; }
.ct-switch { display: flex; align-items: center; justify-content: space-between; gap: ${t.space.lg}px; }
.ct-switch > span { display: flex; flex-direction: column; }
.ct-switch strong { ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; }
.ct-busy { height: 4px; border-radius: ${t.radius.sm}px; background: ${themedColor.panelTile}; overflow: hidden; }
.ct-busy > i { display: block; width: 40%; height: 100%; background: ${t.color.gold}; }
.ct-actions { display: flex; justify-content: flex-end; gap: ${t.space.sm}px; }
`;

type Host = Pick<HostBridge, 'aiToolConnect' | 'aiToolLink' | 'copyText'>;
type Phase =
  | { at: 'pick' }
  | { at: 'working' }
  | { at: 'connected'; text: string }
  | { at: 'failed'; message: string }
  | { at: 'howto' };

const HIDDEN = '••••••••••••';

function HowTo({ host, tool }: { host: Host; tool: AiToolId }) {
  const label = AI_TOOLS.find((entry) => entry.id === tool)!.label;
  const [personal, setPersonal] = useState(false);
  const [shown, setShown] = useState(false);
  const [made, setMade] = useState<AiToolLink | 'network_off' | 'failed' | null>(null);

  useEffect(() => {
    let live = true;
    host.aiToolLink(tool, personal).then(
      (link) => live && setMade(link),
      (error: unknown) =>
        live && setMade(String(error).includes('network_off') ? 'network_off' : 'failed'),
    );
    return () => {
      live = false;
    };
  }, [host, tool, personal]);

  if (made === 'network_off' || made === 'failed') {
    return (
      <p className="pair-alert pair-alert--err" role="alert">
        {made === 'network_off'
          ? 'Scout cannot make a link yet. Turn on "Let other devices connect" in Pair a device first, then try again.'
          : 'Scout could not make a link. Check that the brain is running, then try again.'}
      </p>
    );
  }
  if (made === null) return <p className="ct-lead">Making a link…</p>;

  const real = howToLines(tool, made.link);
  const hidden = howToLines(tool, HIDDEN);
  return (
    <>
      <p className="ct-lead">
        Two steps, in a terminal on the PC that runs {label}
        {real.where !== null && (
          <>
            {' '}
            (the first goes in <span className="ct-file">{real.where}</span>)
          </>
        )}
        . Then restart {label}.
      </p>
      <div className="ct-code">
        <pre>{real.add}</pre>
        <CopyButton text={real.add} copy={host.copyText} label="Copy the add step" />
      </div>
      <div className="ct-code">
        <pre>{shown ? real.pair : hidden.pair}</pre>
        <span className="ct-code__side">
          <CopyButton text={real.pair} copy={host.copyText} label="Copy the pairing line" />
          <Button variant="secondary" onClick={() => setShown((now) => !now)}>
            {shown ? 'Hide link' : 'Show link'}
          </Button>
        </span>
      </div>
      <div className="ct-switch">
        <span>
          <strong id="ct-personal">Let it see personal memories</strong>
          <span className="ct-lead">
            Off by default. Memories kept back as personal stay hidden from this tool.
          </span>
        </span>
        <Toggle
          checked={personal}
          onChange={(on) => {
            setMade(null);
            setPersonal(on);
          }}
          label="Let it see personal memories"
          describedBy="ct-personal"
        />
      </div>
      <p className="pair-alert">
        Keep the link private: it works once and anyone with it can add this tool. Revoke the tool
        in Devices any time.
      </p>
    </>
  );
}

export function ConnectToolDialog({
  host,
  onClose,
  onDone,
}: {
  host: Host;
  onClose: () => void;
  /** The tool was connected: Devices reads its list again. */
  onDone: () => void;
}) {
  const [tool, setTool] = useState<AiToolId>('claude-code');
  const [phase, setPhase] = useState<Phase>({ at: 'pick' });
  const info = AI_TOOLS.find((entry) => entry.id === tool)!;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setUp = (): void => {
    setPhase({ at: 'working' });
    void host.aiToolConnect(tool).then(
      (result) =>
        setPhase(
          result.ok
            ? { at: 'connected', text: result.text }
            : { at: 'failed', message: result.message },
        ),
      () =>
        setPhase({
          at: 'failed',
          message: 'Scout could not reach its brain. Check that it is running.',
        }),
    );
  };

  let body;
  let title = 'Connect another AI tool';
  if (phase.at === 'pick') {
    body = (
      <>
        <p className="ct-lead">
          The tool can then read Scout&apos;s memory and add to it. It cannot run your apps or see
          your screen.
        </p>
        <div className="ct-tools" role="group" aria-label="Tool">
          {AI_TOOLS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="ct-tool"
              aria-pressed={entry.id === tool}
              onClick={() => setTool(entry.id)}
            >
              <DeviceIcon name="term" />
              <strong>{entry.label}</strong>
            </button>
          ))}
        </div>
        <div className="ct-ways">
          <div className="ct-way">
            <h3>Set it up for me</h3>
            <p>Scout adds itself to {info.label}&apos;s settings on this PC.</p>
            <Button variant="primary" onClick={setUp}>
              Set it up
            </Button>
          </div>
          <div className="ct-way">
            <h3>Show me how</h3>
            <p>Scout shows the two lines to run, in your own terminal or settings file.</p>
            <Button variant="secondary" onClick={() => setPhase({ at: 'howto' })}>
              Show me
            </Button>
          </div>
        </div>
        <div className="ct-actions">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </>
    );
  } else if (phase.at === 'working') {
    title = `Connecting ${info.label}`;
    body = (
      <>
        <ol className="ct-steps" aria-busy="true">
          <li>
            <strong>Making a key for {info.label}</strong>
            <span className="ct-lead">Only this tool can use it. You can revoke it any time.</span>
          </li>
          <li>
            <strong>Adding Scout to {info.label}&apos;s settings</strong>
            <span className="ct-file">{info.file}</span>
          </li>
          <li>
            <strong>Checking it can reach Scout&apos;s memory</strong>
          </li>
        </ol>
        <div className="ct-busy" aria-hidden="true">
          <i />
        </div>
      </>
    );
  } else if (phase.at === 'connected') {
    title = `${info.label} is connected`;
    body = (
      <>
        <p className="pair-alert pair-alert--ok" role="status">
          <Icon name="check" /> {phase.text}
        </p>
        <dl className="ct-facts">
          <dt>Can do</dt>
          <dd>Read memory, add to memory</dd>
          <dt>Cannot do</dt>
          <dd>Run your apps, see your screen, read personal memories</dd>
          <dt>Next</dt>
          <dd>Restart {info.label} to pick it up.</dd>
        </dl>
        <div className="ct-actions">
          <Button variant="primary" onClick={onDone} autoFocus>
            Done
          </Button>
        </div>
      </>
    );
  } else if (phase.at === 'failed') {
    title = `Could not set up ${info.label}`;
    body = (
      <>
        <p className="pair-alert pair-alert--err" role="alert">
          <Icon name="err" /> {phase.message}
        </p>
        <div className="ct-actions">
          <Button variant="quiet" onClick={() => setPhase({ at: 'howto' })}>
            Show me how
          </Button>
          <Button variant="primary" onClick={setUp}>
            Try again
          </Button>
        </div>
      </>
    );
  } else {
    title = `Add Scout to ${info.label}`;
    body = (
      <>
        <HowTo host={host} tool={tool} />
        <div className="ct-actions">
          <Button variant="quiet" onClick={() => setPhase({ at: 'pick' })}>
            Back
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{PAIR_CSS}</style>
      <style>{CSS}</style>
      <div className="pair-scrim">
        <div
          className="pair-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Connect another AI tool"
        >
          <h2>{title}</h2>
          {body}
        </div>
      </div>
    </>
  );
}
