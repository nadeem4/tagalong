/**
 * Nebius Token Factory model ids, in one place.
 *
 * VERIFY AGAINST `GET https://api.tokenfactory.nebius.com/v1/models` before relying on
 * these. The text model id is the one Nebius published with the Nemotron 3 Super launch;
 * the vision id could not be checked from the machine that wrote this file (nebius.com
 * and the API were both unreachable), so it is a best guess at Token Factory's naming.
 * The live list replaces this one in Settings whenever a key is stored, so a wrong id
 * here costs a pick from the dropdown, not a code change.
 */

/** Nemotron 3 Super: the text brain every pet starts with. */
export const NEMOTRON_TEXT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';

/** Nemotron Nano 2 VL: used whenever a turn carries an image. Unverified id — see above. */
export const NEMOTRON_VISION_MODEL = 'nvidia/Nemotron-Nano-V2-12b';

/**
 * Nemotron 3 Nano: the small model that answers a watch's frequent yes-or-no check.
 * Unverified id, like the vision one above.
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
