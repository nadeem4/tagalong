"""A machine that only runs a node has no use for the voice models, so loading the node must
never pull them in.
"""

import subprocess
import sys

VOICE = ["faster_whisper", "kokoro_onnx", "moonshine_voice", "onnxruntime", "piper"]


def test_the_node_does_not_import_the_voice_models():
    code = (
        "import sys, brain.node.main\n"
        f"print([m for m in sys.modules if m.split('.')[0] in {VOICE!r} "
        "or m.startswith('brain.voice')])"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    assert out.stdout.strip() == "[]"
