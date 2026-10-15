import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HomeView, HostBridgeProvider } from '@tagalong/ui';
import type { HomeHost, HomePage } from '@tagalong/ui';
import type { RoutineProposedParams } from '@tagalong/protocol';
// Bundled, not fetched: Home's two typefaces ship inside the app, Latin subset only.
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-600.css';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './office.css';
import '../../shared/ipc';
import { overviewStatus, scoutBrain } from './settings/brain';
import { SettingsPage } from './settings/settings-page';
import { homeTarget, scrollToSection } from './home-target';

/** How long Home waits, a tenth of a second at a time, for Settings to draw a section. */
const SCROLL_TRIES = 30;

/** How Home reads and changes the companion on the desktop: the same host calls as before. */
const homeHost: HomeHost = {
  setup: async () => {
    const view = await window.tagalongHost.getHostView();
    return {
      companionId: view.settings.defaultPetId,
      // The fake provider is for tests and demos, never offered.
      providers: view.providers
        .filter((choice) => choice.id !== 'fake')
        .map(({ id, label, needsKey }) => ({ id, label, needsKey })),
      sightLogDays: view.settings.sightLog.days,
    };
  },
  listModels: (providerId) => window.tagalongHost.listModels(providerId),
  savePet: (pet) => window.tagalongHost.savePet(pet),
  // The overview's line: Ready only when Scout can think (signed in, or a key) and see.
  status: async () => {
    const view = await window.tagalongHost.getHostView();
    const scout = view.pets.find((pet) => pet.id === view.settings.defaultPetId) ?? view.pets[0];
    const signIn =
      scout?.providerId === 'claude-code'
        ? await window.tagalongHost.checkClaudeSignIn().catch(() => 'unknown' as const)
        : null;
    const paused = await window.tagalongHost.getSightPaused().catch(() => false);
    return overviewStatus(scoutBrain(scout, view.providers, signIn), paused);
  },
};

/**
 * The Home window (the page keeps its old `office` name): the one window for the companion,
 * its experts, activity and settings. Main names a page when the tray or the bubble opens a
 * particular one, such as Settings.
 */
function Home() {
  const [page, setPage] = useState<HomePage | undefined>(undefined);
  // Scout's routine card, opened here by its Edit button.
  const [routineDraft, setRoutineDraft] = useState<RoutineProposedParams | undefined>(undefined);
  // A Fix it names a Settings section too: Home scrolls to it once Settings has drawn it.
  const [section, setSection] = useState<{ id: string } | null>(null);
  useEffect(
    () =>
      window.tagalongHost.onHomePage((next) => {
        const target = homeTarget(next);
        setPage(target.page);
        setSection(target.section === undefined ? null : { id: target.section });
      }),
    [],
  );
  useEffect(() => {
    if (section === null) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (scrollToSection(document, section.id) || tries >= SCROLL_TRIES) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, [section]);
  useEffect(
    () =>
      window.tagalongHost.onRoutineDraft((proposal) => {
        setRoutineDraft(proposal);
        setPage('routines');
      }),
    [],
  );
  return (
    <HostBridgeProvider bridge={window.tagalong}>
      <HomeView
        host={homeHost}
        settings={<SettingsPage embedded onOpenScout={() => setPage('scout')} />}
        {...(page === undefined ? {} : { page })}
        {...(routineDraft === undefined ? {} : { routineDraft })}
        onPage={setPage}
      />
    </HostBridgeProvider>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <Home />
    </StrictMode>,
  );
}
