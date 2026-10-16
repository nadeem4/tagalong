/**
 * Nebius Token Factory model ids in one place: the Nemotron text, vision and nano models,
 * the fallback list and the vision list. The live list (`GET /v1/models`) replaces these
 * in Settings once a key is stored, so a wrong id costs a pick, not a code change.
 */

/** Nemotron 3 Super: the text brain every pet starts with. */
export const NEMOTRON_TEXT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';

/** Nemotron Nano 2 VL: used whenever a turn carries an image. Not checked against the live list. */
export const NEMOTRON_VISION_MODEL = 'nvidia/Nemotron-Nano-V2-12b';

/**
 * Nemotron 3 Nano: the small model that answers a watch's frequent yes-or-no check.
 * Not checked against the live list.
 */
export const NEMOTRON_NANO_MODEL = 'nvidia/nemotron-3-nano-30b-a3b';

/** Offered in Settings when the live list cannot be fetched. */
export const NEBIUS_FALLBACK_MODELS: readonly string[] = [
  NEMOTRON_TEXT_MODEL,
  NEMOTRON_VISION_MODEL,
  NEMOTRON_NANO_MODEL,
];

/** The Token Factory models that accept images. Every other one is sent text only. */
export const NEBIUS_VISION_MODELS: readonly string[] = [NEMOTRON_VISION_MODEL];
