/**
 * "Connect another AI tool": a dialog over Devices. Pick Claude Code, Codex or Cursor, then
 * either Scout sets it up on this PC (working, connected or failed), or it shows the steps to
 * type, with the pairing link hidden until asked. Contains ConnectToolDialog.
 */
import { useState } from 'react';
import { Button, CopyButton, Toggle } from '../controls';
import type { HostBridge } from '../host-bridge';
import { Icon } from '../icons';
import { PairShell } from '../pair/pair-shell';
import { PAIR_CSS } from '../pair/pair-styles';
import { AI_TOOLS, howToLines } from '../shapes';
import type { AiToolId } from '../shapes';
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
type Tool = (typeof AI_TOOLS)[number];
type Phase =
  | { at: 'pick' }
  | { at: 'working' }
  | { at: 'connected'; text: string }
  | { at: 'failed'; message: string }
  | { at: 'howto' };

const HIDDEN = '••••••••••••';

function titleOf(phase: Phase, tool: Tool): string {
  switch (phase.at) {
    case 'pick':
      return 'Connect another AI tool';
    case 'working':
      return `Connecting ${tool.label}`;
    case 'connected':
      return `${tool.label} is connected`;
    case 'failed':
      return `Could not set up ${tool.label}`;
    case 'howto':
      return `Add Scout to ${tool.label}`;
  }
}

/** The pairing link is made when it is first shown or copied, and again only if the switch moves after that. */
function HowTo({ host, tool }: { host: Host; tool: Tool }) {
  const [personal, setPersonal] = useState(false);
  const [shown, setShown] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<'network_off' | 'failed' | null>(null);

  const make = async (withPersonal: boolean): Promise<string | null> => {
    const result = await host
      .aiToolLink(tool.id, withPersonal)
      .catch((): { ok: false; reason: 'failed' } => ({ ok: false, reason: 'failed' }));
    setError(result.ok ? null : result.reason);
    if (result.ok) setLink(result.link);
    return result.ok ? result.link : null;
  };
  const ensure = (): Promise<string | null> =>
    link === null ? make(personal) : Promise.resolve(link);
  const flip = (on: boolean): void => {
    setPersonal(on);
    if (link === null) return;
    setLink(null);
    void make(on);
  };
  const copyPair = async (): Promise<void> => {
    const made = await ensure();
    if (made !== null) await host.copyText(howToLines(tool.id, made).pair);
  };
  const toggleLink = async (): Promise<void> => {
    if (shown || (await ensure()) !== null) setShown(!shown);
  };

  const { where, add, pair } = howToLines(tool.id, shown && link !== null ? link : HIDDEN);
  return (
    <>
      <p className="ct-lead">
        Two steps, in a terminal on the PC that runs {tool.label}
        {where !== null && (
          <>
            {' '}
            (the first goes in <span className="ct-file">{where}</span>)
          </>
        )}
        . Then restart {tool.label}.
      </p>
      <div className="ct-code">
        <pre>{add}</pre>
        <CopyButton text={add} copy={host.copyText} label="Copy the add step" />
      </div>
      <div className="ct-code">
        <pre>{pair}</pre>
        <span className="ct-code__side">
          <Button
            variant="secondary"
            aria-label="Copy the pairing line"
            onClick={() => void copyPair().catch(() => undefined)}
          >
            Copy
          </Button>
          <Button variant="secondary" onClick={() => void toggleLink()}>
            {shown ? 'Hide link' : 'Show link'}
          </Button>
        </span>
      </div>
      {error !== null && (
        <p className="pair-alert pair-alert--err" role="alert">
          {error === 'network_off'
            ? 'Scout cannot make a link yet. Turn on "Let other devices connect" in Pair a device first, then try again.'
            : 'Scout could not make a link. Check that the brain is running, then try again.'}
        </p>
      )}
      <div className="ct-switch">
        <span>
          <strong id="ct-personal">Let it see personal memories</strong>
          <span className="ct-lead">
            Off by default. Memories kept back as personal stay hidden from this tool.
          </span>
        </span>
        <Toggle
          checked={personal}
          onChange={flip}
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

function Pick({
  tool,
  onTool,
  onSetUp,
  onHowTo,
  onClose,
}: {
  tool: Tool;
  onTool: (id: AiToolId) => void;
  onSetUp: () => void;
  onHowTo: () => void;
  onClose: () => void;
}) {
  return (
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
            aria-pressed={entry.id === tool.id}
            onClick={() => onTool(entry.id)}
          >
            <DeviceIcon name="term" />
            <strong>{entry.label}</strong>
          </button>
        ))}
      </div>
      <div className="ct-ways">
        <div className="ct-way">
          <h3>Set it up for me</h3>
          <p>Scout adds itself to {tool.label}&apos;s settings on this PC.</p>
          <Button variant="primary" onClick={onSetUp}>
            Set it up
          </Button>
        </div>
        <div className="ct-way">
          <h3>Show me how</h3>
          <p>Scout shows the two lines to run, in your own terminal or settings file.</p>
          <Button variant="secondary" onClick={onHowTo}>
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
}

function Working({ tool }: { tool: Tool }) {
  return (
    <>
      <ol className="ct-steps" aria-busy="true">
        <li>
          <strong>Making a key for {tool.label}</strong>
          <span className="ct-lead">Only this tool can use it. You can revoke it any time.</span>
        </li>
        <li>
          <strong>Adding Scout to {tool.label}&apos;s settings</strong>
          <span className="ct-file">{tool.file}</span>
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
}

function Connected({ tool, text, onDone }: { tool: Tool; text: string; onDone: () => void }) {
  return (
    <>
      <p className="pair-alert pair-alert--ok" role="status">
        <Icon name="check" /> {text}
      </p>
      <dl className="ct-facts">
        <dt>Can do</dt>
        <dd>Read memory, add to memory</dd>
        <dt>Cannot do</dt>
        <dd>Run your apps, see your screen, read personal memories</dd>
        <dt>Next</dt>
        <dd>Restart {tool.label} to pick it up.</dd>
      </dl>
      <div className="ct-actions">
        <Button variant="primary" onClick={onDone} autoFocus>
          Done
        </Button>
      </div>
    </>
  );
}

function Failed({
  message,
  onHowTo,
  onRetry,
}: {
  message: string;
  onHowTo: () => void;
  onRetry: () => void;
}) {
  return (
    <>
      <p className="pair-alert pair-alert--err" role="alert">
        <Icon name="err" /> {message}
      </p>
      <div className="ct-actions">
        <Button variant="quiet" onClick={onHowTo}>
          Show me how
        </Button>
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
      </div>
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
  const [toolId, setToolId] = useState<AiToolId>('claude-code');
  const [phase, setPhase] = useState<Phase>({ at: 'pick' });
  const tool = AI_TOOLS.find((entry) => entry.id === toolId)!;

  const setUp = (): void => {
    setPhase({ at: 'working' });
    void host.aiToolConnect(toolId).then(
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
  const howTo = (): void => setPhase({ at: 'howto' });

  return (
    <>
      <style>{PAIR_CSS}</style>
      <style>{CSS}</style>
      <PairShell title={titleOf(phase, tool)} label="Connect another AI tool" onClose={onClose}>
        {phase.at === 'pick' && (
          <Pick tool={tool} onTool={setToolId} onSetUp={setUp} onHowTo={howTo} onClose={onClose} />
        )}
        {phase.at === 'working' && <Working tool={tool} />}
        {phase.at === 'connected' && <Connected tool={tool} text={phase.text} onDone={onDone} />}
        {phase.at === 'failed' && (
          <Failed message={phase.message} onHowTo={howTo} onRetry={setUp} />
        )}
        {phase.at === 'howto' && (
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
        )}
      </PairShell>
    </>
  );
}
