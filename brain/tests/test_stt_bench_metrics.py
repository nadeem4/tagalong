"""Tests for the speech-model measurement harness (brain/tools/stt_bench): the metrics, the
noise mix and the corpus loader. Pure functions on fakes; no model, no download, no audio device.
"""

import numpy as np
import pytest

from tools.stt_bench.corpus import load_folder
from tools.stt_bench.metrics import mix_noise, name_kept, wer


def test_wer_basic():
    assert wer("what time is it", "what time is it") == 0.0
    assert wer("what time is it", "What, time is IT?") == 0.0  # case and punctuation ignored
    assert wer("what time is it", "what tune is it") == 0.25  # substitution
    assert wer("what time is it", "what is it") == 0.25  # deletion
    assert wer("what time is it", "what time is it now") == 0.25  # insertion
    assert wer("", "") == 0.0
    assert wer("", "hello") == 1.0
    assert wer("hello there", "") == 1.0


@pytest.mark.parametrize(
    "text",
    ["Scott, what is this?", "scot what is this", "Scoot, help me", "Skout, help me",
     "Scouts, what is this?", "Hey Scott, explain this.", "ok skott: help", "Hey, Scout!"],
)  # fmt: skip
def test_name_kept_matches_addressing_ts_examples(text):
    assert name_kept(text)


@pytest.mark.parametrize(
    "text",
    ["Scott's car is outside", "Scout’s answer was long", "scout's", "Scope this out for me",
     "About the meeting today", "Count me in for lunch", "Shout if you need me",
     "Scotland is lovely", "Hey, what is this", "Okay. Fine.", ""],
)  # fmt: skip
def test_name_not_kept(text):
    assert not name_kept(text)


def test_corpus_skips_missing_wavs_and_reports_it(tmp_path):
    (tmp_path / "a.wav").write_bytes(b"RIFF")
    (tmp_path / "a.txt").write_text("Scout, what time is it?", encoding="utf-8")
    (tmp_path / "b.txt").write_text("no audio for this one", encoding="utf-8")
    corpus = load_folder(tmp_path)
    assert [c.reference for c in corpus.items] == ["Scout, what time is it?"]
    assert corpus.items[0].wav == tmp_path / "a.wav"
    assert len(corpus.skipped) == 1 and "b.wav" in corpus.skipped[0]


def test_corpus_reports_a_folder_that_is_not_there(tmp_path):
    corpus = load_folder(tmp_path / "nope")
    assert corpus.items == [] and "nope" in corpus.skipped[0]


@pytest.mark.parametrize("snr", [0.0, 10.0, 20.0])
def test_noise_mix_is_at_requested_snr(snr):
    speech = (0.3 * np.sin(np.linspace(0, 400, 16000))).astype(np.float32)
    noisy = mix_noise(speech, snr, seed=7)
    noise = noisy - speech
    measured = 10 * np.log10(np.mean(speech**2) / np.mean(noise**2))
    assert measured == pytest.approx(snr, abs=0.1)
    assert noisy.dtype == np.float32
