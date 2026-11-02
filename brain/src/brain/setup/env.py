"""The environment an expert's process gets: ours, minus the keys that would override its login.

Experts run on the person's own subscription login, never an API key. Which variables switch an
expert to a key differs per expert (found in the 20a spike); an expert we do not know loses all
of them. Login, its check probe and runs share this one table; the ids in it are the tested ones.
"""

from collections.abc import Mapping

_KEYS = {
    "claude-acp": (
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
    ),
    "codex-acp": ("CODEX_API_KEY", "OPENAI_API_KEY"),
    "gemini": (
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "GOOGLE_GENAI_USE_VERTEXAI",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GOOGLE_CLOUD_PROJECT",
    ),
}
_ALL = tuple(sorted({k for keys in _KEYS.values() for k in keys}))


def expert_env(expert_id: str, base: Mapping[str, str]) -> dict[str, str]:
    stripped = _KEYS.get(expert_id, _ALL)
    return {k: v for k, v in base.items() if k not in stripped}


def is_tested(expert_id: str) -> bool:
    """Whether we ran this expert in the spike; anything else is reported as untested."""
    return expert_id in _KEYS
