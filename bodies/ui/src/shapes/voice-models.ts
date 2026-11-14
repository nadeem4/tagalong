/**
 * What Home's Speech to text card reads of the brain's speech models (stt_state), and the options
 * its two selects list. Contains parseSttState, SttState, liveOptions, finalOptions and
 * formatSize; shaped after stt_tools in brain/src/brain/voice/stt_tools.py.
 */
import { z } from 'zod';

const Model = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  role: z.enum(['live', 'final', 'both']),
  size_mb: z.number(),
  gpu: z.enum(['none', 'preferred', 'required']),
  languages: z.array(z.string()),
  note: z.string(),
});

const Wire = z.object({
  live: z.string().min(1),
  final: z.string().min(1),
  models: z.array(Model),
  gpu_name: z.string().nullable(),
});

export type SttState = z.infer<typeof Wire>;

export function parseSttState(json: unknown): SttState {
  return Wire.parse(json);
}

/** One entry of a select; a disabled one is shown but cannot be picked. */
export interface SttOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** The download size as a person reads it: 45 MB, 1.5 GB. */
export function formatSize(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`;
}

function modelOption(m: SttState['models'][number], card: boolean): SttOption {
  const base = `${m.label} · ${formatSize(m.size_mb)}`;
  // A model that cannot run without a graphics card is shown, so the person sees why it is out.
  if (m.gpu === 'required' && !card) {
    return { value: m.id, label: `${base} · Needs a graphics card`, disabled: true };
  }
  return { value: m.id, label: base };
}

/** While you talk: Auto, then the live models. */
export function liveOptions(state: SttState): SttOption[] {
  const card = state.gpu_name !== null;
  return [
    { value: 'auto', label: 'Auto' },
    ...state.models.filter((m) => m.role !== 'final').map((m) => modelOption(m, card)),
  ];
}

/** When you finish: Auto, no second look, then the final models. */
export function finalOptions(state: SttState): SttOption[] {
  const card = state.gpu_name !== null;
  return [
    { value: 'auto', label: 'Auto' },
    { value: 'off', label: "Don't double-check" },
    ...state.models.filter((m) => m.role !== 'live').map((m) => modelOption(m, card)),
  ];
}
