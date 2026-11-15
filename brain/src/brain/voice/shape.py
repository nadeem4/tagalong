"""Audio shaping for one spoken chunk: silence trimmed, edges faded, a set gap appended.

Engines pad their audio with uneven silence, which makes the pauses between chunks uneven. Here
every chunk loses its padding (keeping a little), fades so it never clicks, and ends with a fixed
gap of zeros, so a chunk stays one frame and the body's player needs no change. The constants are
starting values for the listening set to tune.
"""

import numpy as np

TRIM_LEVEL = 0.01  # of full scale: quieter than this at an edge is padding
KEEP_MS = 20  # silence kept at each edge, so the word does not start or stop abruptly
FADE_MS = 8
GAP_MS = 180
PARAGRAPH_GAP_MS = 450


def _samples(ms: float, rate: int) -> int:
    return int(rate * ms / 1000)


def shape_chunk(samples: np.ndarray, rate: int, paragraph_end: bool) -> np.ndarray:
    """int16 in, int16 out: trimmed, faded in and out, then the gap (longer at a paragraph end).
    All-silent input gives just the gap."""
    gap = np.zeros(_samples(PARAGRAPH_GAP_MS if paragraph_end else GAP_MS, rate), dtype=np.int16)
    loud = np.flatnonzero(np.abs(samples.astype(np.int32)) >= TRIM_LEVEL * 32767)
    if loud.size == 0:
        return gap
    keep = _samples(KEEP_MS, rate)
    body = samples[max(loud[0] - keep, 0) : loud[-1] + 1 + keep].astype(np.float32)
    fade = min(_samples(FADE_MS, rate), len(body) // 2)
    if fade:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        body[:fade] *= ramp
        body[-fade:] *= ramp[::-1]
    return np.concatenate([body.astype(np.int16), gap])
