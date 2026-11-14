"""The speech models the person chose in Home: one for the live words, one for the second look.

Saved as the text settings `stt_live` and `stt_final`; `auto` is the default and the word for "let
Scout pick for this PC". A stored id the list no longer has reads as Auto, so a stale row never
breaks listening. `gpu_name` is the card the brain can see, for the chip on Home's Voice page.
"""

import functools
import sqlite3
import subprocess
import sys

from brain.store.settings import get_setting, set_setting
from brain.voice.stt import AUTO, load_models

OFF = "off"  # no second look at the end
_LIVE, _FINAL = "stt_live", "stt_final"


def valid_live(model_id: str) -> bool:
    return model_id == AUTO or any(
        m.id == model_id and m.role in ("live", "both") for m in load_models()
    )


def valid_final(model_id: str) -> bool:
    return model_id in (AUTO, OFF) or any(
        m.id == model_id and m.role in ("final", "both") for m in load_models()
    )


def saved_live(db: sqlite3.Connection) -> str | None:
    """What was saved, or None: the loader then falls back to the env default, then Auto."""
    saved = get_setting(db, _LIVE)
    return saved if saved and valid_live(saved) else None


def saved_final(db: sqlite3.Connection) -> str | None:
    saved = get_setting(db, _FINAL)
    return saved if saved and valid_final(saved) else None


def chosen_live(db: sqlite3.Connection, env: str | None = None) -> str:
    return saved_live(db) or (env if env and valid_live(env) else AUTO)


def chosen_final(db: sqlite3.Connection, env: str | None = None) -> str:
    return saved_final(db) or (env if env and valid_final(env) else AUTO)


def save_live(db: sqlite3.Connection, model_id: str) -> None:
    set_setting(db, _LIVE, model_id)


def save_final(db: sqlite3.Connection, model_id: str) -> None:
    set_setting(db, _FINAL, model_id)


@functools.cache  # the card does not change while the brain runs: ask once
def gpu_name() -> str | None:
    """The first NVIDIA card's name, or None (no card, no driver, too slow, or not Windows)."""
    if sys.platform != "win32":
        return None
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=3,
            check=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),  # no console flash
        ).stdout
    except Exception:
        return None
    lines = out.strip().splitlines()
    return (lines[0].strip() or None) if lines else None
