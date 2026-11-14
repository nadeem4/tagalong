"""Scores for the speech-model harness: word error rate, whether the name "Scout" survived,
and a noise mix at a fixed SNR. Pure and dependency-light so the tests need no model.
"""

import re

import numpy as np

# Mirrors bodies/ui/src/shapes/addressing.ts: the first word after an optional hey/ok/okay,
# which must end there ("Scout's" is talk about Scout, not to it).
_LEADING = re.compile(r"^\s*(?:(?:hey|okay|ok)\b[\s\W]*)?([^\W\d_]+)(?![^\W\d_]|['’-])", re.I)


def _words(text: str) -> list[str]:
    return re.sub(r"[^\w\s']", " ", text.lower()).split()


def wer(reference: str, hypothesis: str) -> float:
    """Word error rate after lowercasing and dropping punctuation; 1.0 for words against none."""
    ref, hyp = _words(reference), _words(hypothesis)
    if not ref:
        return 0.0 if not hyp else 1.0
    row = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        nxt = [i]
        for j, h in enumerate(hyp, 1):
            nxt.append(min(row[j] + 1, nxt[j - 1] + 1, row[j - 1] + (r != h)))
        row = nxt
    return row[-1] / len(ref)


def _edit_distance(a: str, b: str) -> int:
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        nxt = [i]
        for j, y in enumerate(b, 1):
            nxt.append(min(row[j] + 1, nxt[j - 1] + 1, row[j - 1] + (x != y)))
        row = nxt
    return row[-1]


def name_kept(hypothesis: str) -> bool:
    """True when the first word sounds like "Scout": starts sc/sk, one letter away at most."""
    match = _LEADING.match(hypothesis)
    if match is None:
        return False
    heard = re.sub(r"^sk", "sc", match.group(1).lower())
    return heard.startswith("sc") and _edit_distance(heard, "scout") <= 1


def mix_noise(audio: np.ndarray, snr_db: float, seed: int = 0) -> np.ndarray:
    """`audio` plus white noise scaled so speech power over noise power is `snr_db`."""
    noise = np.random.default_rng(seed).standard_normal(audio.shape)
    target = np.mean(audio.astype(np.float64) ** 2) / 10 ** (snr_db / 10)
    noise *= np.sqrt(target / np.mean(noise**2))
    return (audio + noise).astype(np.float32)
