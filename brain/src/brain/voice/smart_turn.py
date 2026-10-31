"""Smart Turn v3.2, the end-of-turn model: the last 8 s as Whisper log-mel features.

The feature code is a numpy port of the Whisper extractor setup used by Pipecat's Smart Turn
analyzer (n_fft 400, hop 160, 80 slaney mels, 8 s), borrowed under its licence:

    BSD 2-Clause License. Copyright (c) 2024-2025, Daily
    Redistribution and use in source and binary forms, with or without modification, are
    permitted provided that the following conditions are met: 1. Redistributions of source
    code must retain the above copyright notice, this list of conditions and the following
    disclaimer. 2. Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation and/or other
    materials provided with the distribution. THIS SOFTWARE IS PROVIDED "AS IS" AND ANY
    EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED; IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
    LIABLE FOR ANY DAMAGES ARISING FROM ITS USE.
"""

from functools import lru_cache
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16_000
SAMPLES = 8 * SAMPLE_RATE
N_FFT = 400
HOP = 160
N_MELS = 80
FRAMES = 800


def _hz_to_mel(hz: np.ndarray) -> np.ndarray:  # slaney scale: linear below 1 kHz, log above
    mel = 3.0 * hz / 200.0
    log_step = 27.0 / np.log(6.4)
    return np.where(hz >= 1000.0, 15.0 + np.log(np.maximum(hz, 1e-9) / 1000.0) * log_step, mel)


def _mel_to_hz(mel: np.ndarray) -> np.ndarray:
    hz = 200.0 * mel / 3.0
    log_step = np.log(6.4) / 27.0
    return np.where(mel >= 15.0, 1000.0 * np.exp(log_step * (mel - 15.0)), hz)


@lru_cache(maxsize=1)
def _mel_filters() -> np.ndarray:
    """(201, 80) triangular filters, slaney-normalised, as Whisper's feature extractor builds."""
    fft_freqs = np.linspace(0.0, SAMPLE_RATE / 2, N_FFT // 2 + 1)
    edges = _mel_to_hz(
        np.linspace(_hz_to_mel(np.array(0.0)), _hz_to_mel(np.array(8000.0)), N_MELS + 2)
    )
    slopes = edges[None, :] - fft_freqs[:, None]
    widths = np.diff(edges)
    down = -slopes[:, :-2] / widths[:-1]
    up = slopes[:, 2:] / widths[1:]
    bank = np.maximum(0.0, np.minimum(down, up))
    return bank * (2.0 / (edges[2 : N_MELS + 2] - edges[:N_MELS]))[None, :]


def features(samples: np.ndarray) -> np.ndarray:
    """Float32 mono 16 kHz samples -> the model input, shape (80, 800). Only the last 8 s count;
    they are normalised to zero mean and unit variance, then left-padded with silence."""
    tail = np.asarray(samples, dtype=np.float32)[-SAMPLES:]
    audio = np.zeros(SAMPLES, dtype=np.float64)
    if len(tail):
        tail64 = tail.astype(np.float64)
        audio[SAMPLES - len(tail) :] = (tail64 - tail64.mean()) / np.sqrt(tail64.var() + 1e-7)
    padded = np.pad(audio, N_FFT // 2, mode="reflect")
    window = np.hanning(N_FFT + 1)[:-1]  # periodic hann
    count = 1 + (len(padded) - N_FFT) // HOP
    index = np.arange(N_FFT)[None, :] + HOP * np.arange(count)[:, None]
    power = np.abs(np.fft.rfft(padded[index] * window, axis=1)) ** 2
    mel = np.maximum(1e-10, _mel_filters().T @ power.T)
    log_mel = np.log10(mel)[:, :-1]
    log_mel = np.maximum(log_mel, log_mel.max() - 8.0)
    return ((log_mel + 4.0) / 4.0).astype(np.float32)


def load(model_path: Path):
    """The real end-of-turn model on onnxruntime. Imported lazily; tests never call this."""
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model_path), options, providers=["CPUExecutionProvider"])
    name = session.get_inputs()[0].name

    class SmartTurn:
        def complete(self, samples: np.ndarray) -> float:
            out = session.run(None, {name: features(samples)[None, :, :]})
            return float(out[0].reshape(-1)[0])

    return SmartTurn()
