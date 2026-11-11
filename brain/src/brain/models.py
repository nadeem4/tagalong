"""The models Scout can think with and which one is chosen.

Anthropic only for now. The person's saved choice (Settings) overrides TAGALONG_MODEL, which stays
the default; a saved id that is no longer listed falls back to it so a stale row never breaks Scout.
"""

import sqlite3
from dataclasses import dataclass

from brain.store.settings import get_setting, set_setting

PROVIDER = "anthropic"
_KEY = "model"


@dataclass(frozen=True)
class ModelInfo:
    id: str
    name: str
    line: str


MODELS: tuple[ModelInfo, ...] = (
    ModelInfo("claude-opus-5-5", "Claude Opus 5.5", "Most capable"),
    ModelInfo("claude-sonnet-5-5", "Claude Sonnet 5.5", "Faster and cheaper"),
    ModelInfo("claude-haiku-5-5", "Claude Haiku 5.5", "Fastest, for simple tasks"),
)
DEFAULT_MODEL_ID = "claude-opus-5-5"


def chosen(db: sqlite3.Connection, env_default: str) -> str:
    saved = get_setting(db, _KEY)
    return saved if any(m.id == saved for m in MODELS) else env_default


def save(db: sqlite3.Connection, model_id: str) -> None:
    set_setting(db, _KEY, model_id)
