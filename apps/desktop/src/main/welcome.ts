/**
 * The Welcome window's main-process half: which coding agents are on this computer, when
 * Welcome opens, Scout's launch line, and what finishing Welcome sets up (Scout's brain, the
 * first expert). Pure but for `isOnPath`, so it is tested without Electron.
 */

import { execFile } from 'node:child_process';
import { recommendedModel } from '@tagalong/core';
import { Pet } from '@tagalong/protocol';
import type { Expert, Role, Settings } from '@tagalong/protocol';
import type { FoundAgent, GreetLine } from '../shared/ipc';

/**
 * The coding agents Welcome looks for, in the order it lists them. `brain` names the
 * provider through which the companion itself can think on that agent's sign-in; only
 * Claude Code has one.
 */
const AGENTS = [
  { id: 'claude-code', label: 'Claude Code', command: 'claude', brain: 'claude-code' },
  { id: 'gemini-cli', label: 'Gemini CLI', command: 'gemini' },
  { id: 'codex', label: 'Codex', command: 'codex' },
] as const;

export async function findAgents(
  onPath: (command: string) => Promise<boolean> = isOnPath,
): Promise<FoundAgent[]> {
  return Promise.all(
    AGENTS.map(async (agent) => ({
      id: agent.id,
      label: agent.label,
      found: await onPath(agent.command).catch(() => false),
      canThink: 'brain' in agent,
    })),
  );
}

/** Whether a command is on the PATH. Finds npm's .cmd shims too, which spawning would miss. */
export function isOnPath(command: string): Promise<boolean> {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    execFile(finder, [command], { windowsHide: true, timeout: 5000 }, (error) => resolve(!error));
  });
}

/**
 * Opens until Welcome is finished. `TAGALONG_SKIP_ONBOARDING=1` keeps it shut for the
 * end-to-end suites, which drive the panel, not Welcome.
 */
export function shouldOpenWelcome(
  settings: Settings,
  env: Record<string, string | undefined>,
): boolean {
  if (env.TAGALONG_SKIP_ONBOARDING === '1') return false;
  return !settings.welcome.done;
}

/**
 * Whether Scout says its one line as the app opens. Not before Welcome is done: the intro
 * after Welcome is the first hello. Not when the greeting is switched off in Settings.
 */
export function shouldGreetOnLaunch(settings: Settings): boolean {
  return settings.welcome.done && settings.greeting;
}

/** Scout's first line when Always listening is on at launch: that it listens, and how to stop. */
export const LISTENING_LINE =
  'I’m listening. Say “Scout, stop”, or switch off Always listening in my bubble.';

/**
 * Scout's one line as the app opens. With Always listening on it is always the listening
 * line, even with the greeting switched off, and nothing is composed; otherwise the composed
 * greeting when one is allowed, or nothing.
 */
export async function launchLine(
  settings: Settings,
  compose: () => Promise<GreetLine>,
): Promise<GreetLine | null> {
  if (settings.listening.always) return { text: LISTENING_LINE };
  return shouldGreetOnLaunch(settings) ? compose() : null;
}

/**
 * The pet as the Companion thinking on `providerId`, on the model its role's tier recommends
 * there. The watch model is dropped: it named the old provider's model. Used by
 * Welcome and by Settings when a key is saved because no Claude sign-in was found.
 */
export function companionOn(current: Pet, providerId: string, companion: Role): Pet {
  const recommended = recommendedModel(companion, providerId);
  const { watchModel: _watch, ...rest } = current;
  return Pet.parse({
    ...rest,
    roleId: companion.id,
    providerId,
    model: recommended?.model ?? current.model,
  });
}

/**
 * The experts finishing Welcome adds: Claude Code when it is installed and no Claude Code
 * expert exists yet. It gets no folder, since each task names its own project, and stays
 * read-only until a task allows edits.
 */
export function welcomeExperts(
  agents: readonly FoundAgent[],
  existing: readonly Expert[],
): Expert[] {
  const claude = agents.find((agent) => agent.id === 'claude-code');
  if (claude?.found !== true) return [];
  if (existing.some((expert) => expert.connection.type === 'claude-code')) return [];
  return [
    {
      id: 'claude-code',
      name: 'Claude Code',
      goodAt: 'Code: reading, explaining, debugging and changing code in a project.',
      enabled: true,
      instructions: '',
      connection: {
        type: 'claude-code',
        canEdit: false,
        canSearchWeb: false,
        plugins: [],
        mcpTools: [],
        workspace: 'project',
      },
    },
  ];
}
