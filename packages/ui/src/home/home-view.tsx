import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { Pet, Role, RolesUpgradeNotice } from '@tagalong/protocol';
import { useHostBridge } from '../host-bridge';
import { ROOM_COUNT } from '../office/layout';
import { jobFor } from '../office/job';
import type { OfficeMember } from '../office/member';
import { MeetingsPanel } from '../office/meetings-panel';
import { OFFICE_CSS } from '../office/office-styles';
import { PartyList } from '../office/party-list';
import { PixelSprite } from '../office/pixel-sprite';
import { RolesNotice } from '../office/roles-notice';
import { CHARACTERS, characterFor } from '../office/sprites/characters';
import { NO_ACTIVITY, nextActivity, statusOf } from '../office/status';
import { readStill, writeStill } from '../office/still';
import { officeTokens as t } from '../office/tokens';
import { SETTINGS_CSS } from '../settings/settings-styles';
import { ActivityView } from './activity-view';
import { AgentControls } from './agent-controls';
import type { AgentHost } from './agent-controls';
import { HOME_CSS } from './home-styles';
import { newAgent } from './new-agent';
import { placeAgents } from './theme';
import type { Theme } from './theme';
import { DEFAULT_THEME } from './themes';

const NOT_YET = 'Task assignment arrives in a later update';

type Tab = 'activity' | 'agent' | 'meetings';
const TABS: readonly Tab[] = ['activity', 'agent', 'meetings'];

export interface HomeViewProps {
  /** The centre scene's theme. Only the scene changes with it; the chrome never does. */
  theme?: Theme;
  /** How this host changes an agent. Absent, Home shows the agents and their work only. */
  agentHost?: AgentHost;
}

/**
 * Home, the control centre: every agent in a fixed list on the left, what each is doing in
 * the themed scene in the centre, and on the right what the crew did (activity), the picked
 * agent's controls and the meetings. The top bar, the list and the right panel are Home's
 * chrome and are identical in every theme. Host-agnostic: the crew, the roles and the turn
 * events come through the HostBridge, agent edits through `agentHost`.
 */
export function HomeView({ theme = DEFAULT_THEME, agentHost }: HomeViewProps = {}) {
  const bridge = useHostBridge();
  const [pets, setPets] = useState<Pet[] | null>(null);
  const [rolesNotice, setRolesNotice] = useState<RolesUpgradeNotice | null>(null);
  const [roles, setRoles] = useState<readonly Role[]>([]);
  const [failed, setFailed] = useState(false);
  const [activity, setActivity] = useState(NO_ACTIVITY);
  const [picked, setPicked] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('activity');
  const [setup, setSetup] = useState<Awaited<ReturnType<AgentHost['setup']>> | null>(null);
  const [still, setStill] = useState(readStill);
  const toggleStill = () => {
    writeStill(!still);
    setStill(!still);
  };

  useEffect(() => {
    let live = true;
    // Roles only name the jobs: without them every pet reads as a generalist, but the crew
    // still shows, so a roles failure is logged rather than shown as an outage.
    const listed = bridge.listRoles().catch((error: unknown) => {
      console.error('could not list roles', error);
      return [];
    });
    // The notice is a courtesy: if it cannot be read, Home opens without it.
    const unseen = bridge.rolesNotice().catch((error: unknown) => {
      console.error('could not read the roles notice', error);
      return null;
    });
    Promise.all([bridge.listPets(), listed, unseen])
      .then(([list, library, notice]) => {
        if (!live) return;
        setRoles(library);
        setPets(list);
        setRolesNotice(notice);
      })
      .catch((error: unknown) => {
        console.error('could not list pets', error);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [bridge]);

  useEffect(() => {
    if (agentHost === undefined) return;
    let live = true;
    agentHost
      .setup()
      .then((next) => live && setSetup(next))
      .catch((error: unknown) => console.error('could not read the agent setup', error));
    return () => {
      live = false;
    };
  }, [agentHost]);

  useEffect(
    () => bridge.onTurnEvent((event) => setActivity((current) => nextActivity(current, event))),
    [bridge],
  );

  const members = useMemo<OfficeMember[]>(
    () =>
      (pets ?? []).map((pet) => ({
        pet,
        character: characterFor(pet),
        job: jobFor(pet.roleId, roles),
        status: statusOf(activity, pet.id),
      })),
    [pets, roles, activity],
  );
  // Meetings and needs-you do not exist in the engine yet, so every agent works alone.
  const placements = useMemo(
    () =>
      placeAgents(
        theme.layout,
        members.map((member) => ({ id: member.pet.id, whereabouts: { kind: 'alone' } })),
      ),
    [theme, members],
  );

  /** Seen: closed here at once, and marked seen in the engine so it never comes back. */
  const dismissNotice = (): void => {
    setRolesNotice(null);
    bridge
      .dismissRolesNotice()
      .catch((error: unknown) => console.error('could not dismiss the roles notice', error));
  };

  const selected = members.find((m) => m.pet.id === picked) ?? members[0];
  const selectedId = selected?.pet.id ?? null;
  const pickAgent = (petId: string): void => {
    setPicked(petId);
    setTab('agent');
  };

  /** A new generalist on the host's default brain, saved, then picked so its controls open. */
  const addAgent = async (): Promise<void> => {
    if (agentHost === undefined || setup === null) return;
    const providerId = setup.newAgentProviderId;
    const recommended = await bridge.recommendModel('generalist', providerId).catch(() => ({}));
    const model =
      'model' in recommended && recommended.model !== undefined
        ? recommended.model
        : (await agentHost.listModels(providerId)).models[0];
    if (model === undefined) throw new Error(`no model to start a new agent on ${providerId}`);
    const saved = await agentHost.savePet(
      newAgent({
        pets: pets ?? [],
        roles,
        providerId,
        model,
        visionModel: 'visionModel' in recommended ? recommended.visionModel : undefined,
      }),
    );
    setPets((current) => [...(current ?? []), saved]);
    pickAgent(saved.id);
  };

  const notice = failed ? (
    <p role="alert" style={{ margin: t.space.sm, fontSize: t.fontSize.body }}>
      Tagalong could not reach the crew. Check that the app finished starting, then reopen Home.
    </p>
  ) : pets === null ? (
    <p style={{ margin: t.space.sm, fontSize: t.fontSize.body, color: t.color.textMuted }}>
      Waking the crew…
    </p>
  ) : undefined;

  const { Scene } = theme;
  return (
    <div className={still ? 'office home office-still' : 'office home'}>
      <style>{OFFICE_CSS}</style>
      <style>{SETTINGS_CSS}</style>
      <style>{HOME_CSS}</style>
      <TopBar still={still} onToggleStill={toggleStill} />
      <div className="home-body">
        <PartyList
          members={members}
          selectedId={selectedId}
          onSelect={pickAgent}
          {...(notice !== undefined ? { notice } : {})}
          {...(agentHost !== undefined && setup !== null && pets !== null
            ? {
                footer: (
                  <button
                    type="button"
                    className="office-toggle home-add"
                    onClick={() =>
                      void addAgent().catch((error: unknown) =>
                        console.error('could not add an agent', error),
                      )
                    }
                  >
                    Add agent
                  </button>
                ),
              }
            : {})}
        />
        <Scene members={members} selectedId={selectedId} placements={placements} />
        <SidePanel
          tab={tab}
          onTab={setTab}
          agentLabel={selected?.pet.name ?? 'Agent'}
          activity={<ActivityView pets={pets ?? []} />}
          agent={
            selected === undefined ? (
              <p className="home-note">No agent to show yet.</p>
            ) : agentHost === undefined ? (
              <p className="home-note">Agents can be changed in the Tagalong desktop app.</p>
            ) : setup === null ? (
              <p className="home-note">Loading {selected.pet.name}’s controls…</p>
            ) : (
              <AgentControls
                key={selected.pet.id}
                pet={selected.pet}
                roles={roles}
                providers={setup.providers}
                host={agentHost}
                desktopPetId={setup.desktopPetId}
                onDesktopPet={(desktopPetId) => setSetup({ ...setup, desktopPetId })}
                onSaved={(saved) =>
                  setPets((current) =>
                    (current ?? []).map((pet) => (pet.id === saved.id ? saved : pet)),
                  )
                }
                onDeleted={(petId) => {
                  setPets((current) => (current ?? []).filter((pet) => pet.id !== petId));
                  setTab('activity');
                }}
              />
            )
          }
        />
      </div>
      {rolesNotice !== null && (
        <RolesNotice
          notice={rolesNotice}
          roles={roles}
          members={members}
          onDismiss={dismissNotice}
          onReview={() => {
            dismissNotice();
            setTab('agent');
          }}
        />
      )}
    </div>
  );
}

const TAB_NAMES: Record<Tab, (agent: string) => string> = {
  activity: () => 'Activity',
  agent: (agent) => agent,
  meetings: () => 'Meetings',
};

/** The right-hand panel: Activity, the picked agent's controls, Meetings. */
function SidePanel({
  tab,
  onTab,
  agentLabel,
  activity,
  agent,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  agentLabel: string;
  activity: ReactNode;
  agent: ReactNode;
}) {
  const base = useId();
  const tabs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const id = (which: Tab, part: 'tab' | 'panel') => `${base}-${which}-${part}`;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length] ?? 'activity';
    onTab(next);
    tabs.current[next]?.focus();
  };
  const panels: Record<Tab, ReactNode> = {
    activity,
    agent,
    meetings: <MeetingsPanel />,
  };
  return (
    <div className="home-side">
      <div role="tablist" aria-label="Home" className="home-tabs">
        {TABS.map((which) => (
          <button
            key={which}
            ref={(node) => {
              tabs.current[which] = node;
            }}
            type="button"
            role="tab"
            id={id(which, 'tab')}
            className="home-tab"
            aria-selected={tab === which}
            aria-controls={id(which, 'panel')}
            tabIndex={tab === which ? 0 : -1}
            onClick={() => onTab(which)}
            onKeyDown={onKeyDown}
          >
            {TAB_NAMES[which](agentLabel)}
          </button>
        ))}
      </div>
      {TABS.map((which) => (
        // Every panel stays mounted, so the activity keeps listening and an agent's unsaved
        // edits survive a look at the activity.
        <div
          key={which}
          role="tabpanel"
          id={id(which, 'panel')}
          aria-labelledby={id(which, 'tab')}
          hidden={tab !== which}
          className="home-panel"
        >
          {panels[which]}
        </div>
      ))}
    </div>
  );
}

function TopBar({ still, onToggleStill }: { still: boolean; onToggleStill: () => void }) {
  const logo = CHARACTERS['scout'];
  return (
    <header className="home-bar">
      <div className="home-bar__title">
        {logo !== undefined && <PixelSprite sprite={logo.sprite} scale={t.spriteScale.logo} />}
        <h1 className="office-px">Home</h1>
      </div>
      <label title={NOT_YET} style={{ flex: 1, display: 'flex' }}>
        <span style={VISUALLY_HIDDEN}>Assign a task</span>
        <input
          className="office-field"
          disabled
          placeholder={NOT_YET}
          style={{
            flex: 1,
            background: t.color.field,
            border: `1px solid ${t.color.fieldLine}`,
            color: t.color.text,
          }}
        />
      </label>
      <button type="button" className="office-btn" disabled title={NOT_YET}>
        Assign
      </button>
      <button
        type="button"
        className="office-toggle"
        aria-pressed={still}
        title="Stop the crew's idle animation"
        onClick={onToggleStill}
      >
        Still office
      </button>
      <span className="home-bar__meta">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M4 14V2h7v12M2.5 14h11M8.5 8h.01" />
        </svg>
        {`${ROOM_COUNT} of ${ROOM_COUNT} rooms free`}
      </span>
    </header>
  );
}

const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;
