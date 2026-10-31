"""Silero VAD on onnxruntime: speech or not, one 512-sample (32 ms) window at a time.

The model is recurrent, so the adapter keeps its state and the last 64 samples between calls;
`reset` clears both, which a new listening session must do. Not unit tested (needs the real
model); covered by the hand run in the PR.
"""

from pathlib import Path

import numpy as np

CONTEXT = 64
THRESHOLD = 0.5


def load(model_path: Path):
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model_path), options, providers=["CPUExecutionProvider"])
    rate = np.array(16_000, dtype=np.int64)

    class Silero:
        def __init__(self) -> None:
            self.reset()

        def reset(self) -> None:
            self._state = np.zeros((2, 1, 128), dtype=np.float32)
            self._context = np.zeros((1, CONTEXT), dtype=np.float32)

        def speech(self, frame: np.ndarray) -> bool:
            window = np.concatenate([self._context, frame.reshape(1, -1)], axis=1)
            out, self._state = session.run(
                None, {"input": window, "state": self._state, "sr": rate}
            )
            self._context = window[:, -CONTEXT:]
            return float(out.reshape(-1)[0]) >= THRESHOLD

    return Silero()
