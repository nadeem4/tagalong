"""The voice the person chose in Home, saved as the text setting `tts_voice`.

`auto` is the default and means the roster's auto row (Piper alan). A stored id the roster no
longer lists (a dropped licence) reads as Auto, so a stale row never silences Scout.
"""

import sqlite3

from brain.store.settings import get_setting, set_setting
from brain.voice.tts import AUTO, TtsVoice, auto_voice, voice_by_id

_KEY = "tts_voice"


def valid(voice_id: str) -> bool:
    return voice_id == AUTO or voice_by_id(voice_id) is not None


def saved(db: sqlite3.Connection) -> str | None:
    """What was saved, or None when unset or no longer listed."""
    stored = get_setting(db, _KEY)
    return stored if stored and valid(stored) else None


def chosen(db: sqlite3.Connection) -> str:
    return saved(db) or AUTO


def resolved(db: sqlite3.Connection) -> TtsVoice:
    """The row Scout speaks with: Auto becomes the auto row."""
    pick = chosen(db)
    return (None if pick == AUTO else voice_by_id(pick)) or auto_voice()


def save(db: sqlite3.Connection, voice_id: str) -> None:
    set_setting(db, _KEY, voice_id)
