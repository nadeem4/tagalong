/**
 * The install card in the chat: the brain's Allow ask for an app or an expert, drawn as the one
 * InstallCard, which then stays in place and follows the install (steps, percent, sign in, done
 * or failed) instead of vanishing when the person answers. Progress is read from the same places
 * Connections reads it: the setup overview for an expert, the connections list for an app.
 * Contains InstallConfirm.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectorConfirmParams } from '../shapes';
import type { AppInfo } from '../shapes';
import { stageWords } from '../home/experts-group';
import { useHostBridge } from '../host-bridge';
import type { HostBridge } from '../host-bridge';
import {
  InstallCard,
  subjectOf,
  type InstallStep,
  type InstallSubject,
  type InstallView,
} from './install-card';

const APP_STEPS = ['Checking it', 'Connecting', 'Signing in'] as const;

const stepsAt = (at: number, failed: boolean): InstallStep[] =>
  APP_STEPS.map((label, i) => ({
    label,
    state: i < at ? 'done' : i === at ? (failed ? 'fail' : 'now') : 'todo',
  }));

const findApp = (apps: AppInfo[], s: InstallSubject): AppInfo | undefined => {
  const slug = s.id.toLowerCase();
  return apps.find(
    (a) =>
      a.id.toLowerCase() === slug ||
      a.name.toLowerCase() === s.name.toLowerCase() ||
      slug.includes(a.id.toLowerCase()),
  );
};

/** What an app install looks like right now, from its connection row (none yet: checking). */
function appView(
  row: AppInfo | undefined,
  s: InstallSubject,
  furthest: number,
): [InstallView, number] {
  if (row === undefined) return [{ phase: 'working', steps: stepsAt(0, false) }, 0];
  if (row.status === 'connected') {
    return [{ phase: 'done', tools: row.tools.map((tool) => tool.name) }, 2];
  }
  if (row.status === 'error') {
    return [
      {
        phase: 'failed',
        error: `${s.name} didn't finish connecting. Nothing was connected.`,
        steps: stepsAt(furthest, true),
      },
      furthest,
    ];
  }
  if (row.status === 'needs-sign-in') {
    return [
      {
        phase: 'working',
        steps: stepsAt(2, false),
        note: 'Your browser opened to sign in.',
      },
      2,
    ];
  }
  return [{ phase: 'working', steps: stepsAt(1, false) }, 1];
}

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
      note: 'Into Tagalong’s own folder.',
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
}: {
  confirm: ConnectorConfirmParams;
  /** The card is finished with: Not now, Later. */
  onGone: () => void;
  /** A "try asking" prompt of the done card. */
  onTry: (prompt: string) => void;
  /** Try again after a failure: asks Scout to set it up again. */
  onRetry: (name: string) => void;
}) {
  const bridge = useHostBridge();
  const base = useMemo(() => subjectOf(confirm.tool, confirm.facts ?? {}), [confirm]);
  const [name, setName] = useState<string | null>(null);
  const subject = name === null ? base : { ...base, name };
  const [allowed, setAllowed] = useState(false);
  const [view, setView] = useState<InstallView>({ phase: 'ask' });
  const furthest = useRef(0);

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
            const [next, at] = appView(findApp(apps, subject), subject, furthest.current);
            furthest.current = Math.max(furthest.current, at);
            done(next);
          },
          () => undefined,
        );
      }
    };
    read();
    const offSetup = bridge.onBrainChanged((what) => what === 'setup' && read());
    const offTurn = bridge.onTurnEvent((event) => event.type === 'connections.changed' && read());
    return () => {
      live = false;
      offSetup();
      offTurn();
    };
    // `subject` only changes name; the reads need the id and kind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, bridge, base.id, base.kind, subject.name]);

  const allow = (): void => {
    void bridge.approveTool(confirm.approvalId, 'once').then(
      () => {
        setAllowed(true);
        setView({ phase: 'working', label: 'Starting…' });
      },
      () => undefined,
    );
  };
  const notNow = (): void => {
    if (view.phase === 'ask') {
      void bridge.approveTool(confirm.approvalId, 'deny').then(onGone, () => undefined);
    } else {
      onGone();
    }
  };

  return (
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
  );
}
