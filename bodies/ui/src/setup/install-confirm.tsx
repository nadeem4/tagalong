/**
 * The install card in the chat: the brain's Allow ask for an app or an expert, drawn as the one
 * InstallCard, which then stays in place and follows the install (steps, percent, sign in, done
 * or failed) instead of vanishing when the person answers. Progress is read from the same places
 * Connections reads it: the setup overview for an expert, the connections list for an app.
 * Contains InstallConfirm.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectorConfirmParams } from '../shapes';
import { stageWords } from '../home/experts-group';
import { useHostBridge } from '../host-bridge';
import type { HostBridge } from '../host-bridge';
import { InstallCard, subjectOf, type InstallSubject, type InstallView } from './install-card';
import { appView, findApp } from './install-progress';

/** How long an error row that has not changed since Allow is trusted to be this install's own. */
const STALE_ERROR_MS = 8000;

/** What an expert install looks like right now, from the setup overview. */
function expertView(
  overview: Awaited<ReturnType<HostBridge['setupOverview']>>,
  s: InstallSubject,
): InstallView {
  if (overview.failed?.expert === s.id) {
    return {
      phase: 'failed',
      error: `${s.name} didn't finish installing. Nothing was installed.`,
    };
  }
  const p = overview.progress;
  if (p !== null && (p.expert === undefined || p.expert === s.id)) {
    const words = stageWords({ stage: p.stage });
    return {
      phase: 'working',
      label: `${words}…`,
      ...(p.percent !== undefined ? { percent: p.percent } : {}),
      note: "Into Tagalong's own folder, about 60 MB",
    };
  }
  const row = overview.experts.find((e) => e.id === s.id);
  if (row?.state === 'needs_login') return { phase: 'signin' };
  if (row !== undefined) return { phase: 'done', tryPrompts: ['Fix the failing test'] };
  return { phase: 'working', label: 'Checking this computer…' };
}

export function InstallConfirm({
  confirm,
  onGone,
  onTry,
  onRetry,
  onWorking,
  onAllowing,
}: {
  confirm: ConnectorConfirmParams;
  /** The card is finished with: Not now, Later. */
  onGone: () => void;
  /** A "try asking" prompt of the done card. */
  onTry: (prompt: string) => void;
  /** Try again after a failure: asks Scout to set it up again. */
  onRetry: (name: string) => void;
  /** The header's words while this install works ("Setting up Notion"); null when it does not. */
  onWorking?: (status: string | null) => void;
  /** Allow was pressed (true), or its answer did not get through (false): the ask is not open any more. */
  onAllowing?: (allowing: boolean) => void;
}) {
  const bridge = useHostBridge();
  const base = useMemo(() => subjectOf(confirm.tool, confirm.facts ?? {}), [confirm]);
  const [name, setName] = useState<string | null>(null);
  const subject = name === null ? base : { ...base, name };
  const [allowed, setAllowed] = useState(false);
  const [view, setView] = useState<InstallView>({ phase: 'ask' });
  const furthest = useRef(0);
  // An app row already in error when Allow was pressed is an old failure: only an error that
  // comes after a change (a new status, or other words) is this install's own.
  const oldError = useRef<string | null>(null);
  const fresh = useRef(false);

  // The brain knows the real name of what it is installing: use it once it is listed.
  useEffect(() => {
    let live = true;
    bridge.setupOverview().then(
      (o) => {
        const known = [...o.experts, ...o.browseExperts, ...o.apps, ...o.browseApps].find(
          (x) => x.id === base.id,
        );
        if (live && known !== undefined && known.name !== '') setName(known.name);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [bridge, base.id]);

  // After Allow, follow the install until the person closes the card.
  useEffect(() => {
    if (!allowed) return;
    let live = true;
    const read = (): void => {
      const done = (next: InstallView): void => {
        if (live) setView(next);
      };
      if (base.kind === 'expert') {
        bridge.setupOverview().then(
          (o) => done(expertView(o, subject)),
          () => undefined,
        );
      } else {
        bridge.listConnections().then(
          ({ apps }) => {
            let row = findApp(apps, subject);
            if (row?.status !== 'error' || row.error !== oldError.current) fresh.current = true;
            if (row?.status === 'error' && !fresh.current) row = undefined;
            const [next, at] = appView(row, subject, furthest.current);
            furthest.current = Math.max(furthest.current, at);
            done(next);
          },
          () => undefined,
        );
      }
    };
    read();
    // A retry can fail with the very text of the last failure, so an error row that never
    // changed cannot tell "not started" from "failed again". After a while the row is the answer.
    const settle = setTimeout(() => {
      fresh.current = true;
      read();
    }, STALE_ERROR_MS);
    const offSetup = bridge.onBrainChanged((what) => what === 'setup' && read());
    const offTurn = bridge.onTurnEvent((event) => event.type === 'connections.changed' && read());
    return () => {
      live = false;
      clearTimeout(settle);
      offSetup();
      offTurn();
    };
    // `subject` only changes name; the reads need the id and kind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, bridge, base.id, base.kind, subject.name]);

  const working = view.phase === 'working';
  useEffect(() => {
    onWorking?.(
      working ? `${base.kind === 'expert' ? 'Installing' : 'Setting up'} ${subject.name}` : null,
    );
    return () => onWorking?.(null);
    // onWorking is a state setter in the bubble; it never changes meaning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working, base.kind, subject.name]);

  const allow = (): void => {
    onAllowing?.(true);
    const remember =
      base.kind === 'app'
        ? bridge.listConnections().then(
            ({ apps }) => {
              const row = findApp(apps, subject);
              oldError.current = row?.status === 'error' ? row.error : null;
            },
            () => undefined,
          )
        : Promise.resolve();
    void remember
      .then(() => bridge.approveTool(confirm.approvalId, 'once'))
      .then(
        () => {
          setAllowed(true);
          setView({ phase: 'working', label: 'Starting…' });
        },
        () => onAllowing?.(false),
      );
  };
  const notNow = (): void => {
    if (view.phase === 'ask') {
      // A refused answer (the ask closed, or the brain went away) drops the card too: it must
      // not stay up with a live Allow for an ask nobody is waiting on.
      void bridge.approveTool(confirm.approvalId, 'deny').then(onGone, onGone);
    } else {
      onGone();
    }
  };

  // The card grows below the fold as it works (a failure adds its words): keep all of it in view.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.scrollIntoView?.({ block: 'nearest' });
  }, [view]);

  return (
    <div ref={root}>
      <InstallCard
        subject={subject}
        view={view}
        onAllow={allow}
        onNotNow={notNow}
        onRetry={() => onRetry(subject.name)}
        onSignIn={() => void bridge.setupExpert(subject.id, true)}
        onLater={onGone}
        onManage={() => void bridge.openFix('connections')}
        onTry={onTry}
      />
    </div>
  );
}
