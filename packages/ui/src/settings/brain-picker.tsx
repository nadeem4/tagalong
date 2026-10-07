import { useId } from 'react';
import type { ModelTier } from '@tagalong/protocol';
import { CheckIcon, EditIcon } from './icons';

/** What a role would like on a provider. Absent fields mean nothing is recommended. */
export interface ModelRecommendation {
  model?: string;
  visionModel?: string;
}

export interface BrainChange {
  providerId?: string;
  model?: string;
  visionModel?: string;
}

export interface BrainPickerProps {
  providers: readonly { id: string; label: string }[];
  providerId: string;
  model: string;
  visionModel: string;
  /** Suggestions for the model boxes; any id is still accepted. */
  models: readonly string[];
  /** A line under the model boxes, such as where the suggestions came from. */
  modelsNote?: string;
  roleName: string;
  tier: ModelTier;
  recommended?: ModelRecommendation;
  onChange: (change: BrainChange) => void;
}

/**
 * A pet's provider and model. The role only recommends: the chip says whether the model is
 * the recommended one or the user's own choice, and one button puts the recommendation back.
 */
export function BrainPicker({
  providers,
  providerId,
  model,
  visionModel,
  models,
  modelsNote,
  roleName,
  tier,
  recommended,
  onChange,
}: BrainPickerProps) {
  const listId = useId();
  const recommendedModel = recommended?.model;
  const onRecommended = recommendedModel !== undefined && model === recommendedModel;
  return (
    <div>
      <label>
        <span>Provider</span>
        <select
          value={providerId}
          onChange={(event) => onChange({ providerId: event.target.value })}
        >
          {providers.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Model id</span>
        <input
          value={model}
          list={listId}
          onChange={(event) => onChange({ model: event.target.value })}
        />
      </label>
      <div className="tg-brain">
        <span className="tg-chip" data-testid="brain-chip">
          {onRecommended ? <CheckIcon /> : <EditIcon />}
          {onRecommended ? 'Recommended' : 'Your choice'}
        </span>
        {recommendedModel !== undefined && (
          <span className="tg-note" style={{ margin: 0 }}>
            A {roleName} is recommended a {tier} brain: {recommendedModel}.
          </span>
        )}
        {recommendedModel !== undefined && !onRecommended && (
          <button
            type="button"
            className="tg-btn-quiet"
            onClick={() =>
              onChange({ model: recommendedModel, visionModel: recommended?.visionModel ?? '' })
            }
          >
            Use recommended
          </button>
        )}
      </div>
      <label>
        <span>Vision model id (blank if the model above can see images)</span>
        <input
          value={visionModel}
          list={listId}
          onChange={(event) => onChange({ visionModel: event.target.value })}
        />
      </label>
      <datalist id={listId}>
        {models.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      {modelsNote !== undefined && <p className="tg-note">{modelsNote}</p>}
    </div>
  );
}
