import { useId } from 'react';
import type { ReactNode } from 'react';
import type { Pet, Role, ToolGrant } from '@tagalong/protocol';
import { BrainPicker } from './brain-picker';
import type { ModelRecommendation } from './brain-picker';
import { DirectoryCard } from './directory-card';
import { RolePicker } from './role-picker';
import { brainLabel } from './roles-view';
import { ToolToggles } from './tool-toggles';

/** The parts of a pet this editor changes, as the user is typing them. */
export interface PetDraft {
  name: string;
  roleId: string;
  providerId: string;
  model: string;
  /** Empty means none. */
  visionModel: string;
  toolGrants: Record<string, ToolGrant>;
  /** Empty means none. */
  notes: string;
}

export interface PetSettingsProps {
  /** The pet as stored: its look and its current role. */
  pet: Pet;
  draft: PetDraft;
  roles: readonly Role[];
  providers: readonly { id: string; label: string }[];
  models: readonly string[];
  modelsNote?: string;
  recommended?: ModelRecommendation;
  onChange: (draft: PetDraft) => void;
  /** Host fields that are not about the role: look, reply style, the desktop strip. */
  children?: ReactNode;
}

/**
 * One pet's role, brain, tools and notes, beside the directory card its teammates will read.
 * Pure: roles, models and the recommendation come in as props, every edit goes out through
 * `onChange`, so the host decides where they come from and when they are saved.
 */
export function PetSettings({
  pet,
  draft,
  roles,
  providers,
  models,
  modelsNote,
  recommended,
  onChange,
  children,
}: PetSettingsProps) {
  const notesId = useId();
  const nameId = useId();
  const role = roles.find((candidate) => candidate.id === draft.roleId);
  const change = (patch: Partial<PetDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="tg-pet">
      <div>
        <label htmlFor={nameId}>
          <span>Name</span>
        </label>
        <input
          id={nameId}
          value={draft.name}
          onChange={(event) => change({ name: event.target.value })}
          style={{ marginBottom: 12 }}
        />
        <h3>Role</h3>
        <RolePicker
          petName={draft.name}
          roles={roles}
          roleId={draft.roleId}
          savedRoleId={pet.roleId}
          // A new role brings its own tools, so the old role's switches do not carry over.
          onChange={(roleId) => change({ roleId, toolGrants: {} })}
        />
        <h3>Brain</h3>
        <BrainPicker
          providers={providers}
          providerId={draft.providerId}
          model={draft.model}
          visionModel={draft.visionModel}
          models={models}
          {...(modelsNote !== undefined ? { modelsNote } : {})}
          roleName={role?.name ?? draft.roleId}
          tier={role?.model.tier ?? 'balanced'}
          {...(role !== undefined && recommended !== undefined ? { recommended } : {})}
          onChange={(brain) => change(brain)}
        />
        <h3>Tools</h3>
        {role === undefined ? (
          <p className="tg-note">The tools appear once the role library has loaded.</p>
        ) : (
          <>
            <ToolToggles
              role={role}
              grants={draft.toolGrants}
              onChange={(toolGrants) => change({ toolGrants })}
            />
            <p className="tg-note" style={{ marginTop: 8 }}>
              The role decides which tools are offered. You decide which are on.
            </p>
          </>
        )}
        <h3>Notes</h3>
        <label htmlFor={notesId}>
          <span>Notes (optional, private)</span>
        </label>
        <textarea
          id={notesId}
          rows={3}
          value={draft.notes}
          onChange={(event) => change({ notes: event.target.value })}
        />
        <p className="tg-note">
          Added after the role&apos;s instructions. Never shown to teammates.
        </p>
        {children}
      </div>
      {role !== undefined && (
        <DirectoryCard
          pet={pet}
          name={draft.name}
          role={role}
          grants={draft.toolGrants}
          brain={brainLabel(role, draft.model, recommended?.model)}
        />
      )}
    </div>
  );
}
