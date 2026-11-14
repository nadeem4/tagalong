"""The bench labels a model by the device it really ran on: a requested-GPU run that ended on
the processor is CPU. Fake engine, no models."""

import numpy as np

from tools.stt_bench.__main__ import decode


class Final:
    def __init__(self, device):
        self.device = device

    def transcribe(self, audio):
        return "hi"


def run(device):
    calls = []

    class Engine:
        def load_final(self, model, folder, progress, cpu_ok):
            calls.append(cpu_ok)
            return Final(device)

    model = type("M", (), {"role": "final"})()
    audio = [(None, np.zeros(16_000, np.float32))]
    return decode(model, Engine(), None, audio), calls


def test_decode_reports_the_device_the_final_model_used():
    got, calls = run("cpu")
    assert got[4] == "cpu" and calls == [True]  # the bench takes the processor, and says so
    assert run("cuda")[0][4] == "cuda"
