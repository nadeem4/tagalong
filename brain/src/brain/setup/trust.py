"""Who counts as Official: an app whose registry namespace is the service's own reversed domain.

The registry proves a namespace by DNS or HTTP, so `com.notion` is Notion's; a GitHub login
(`io.github.*`) proves only who the user is, so it never counts. Experts are Official only when
the vendor is on a short allowlist. Everything else is Community.
"""

import re

# Full registry ids whose namespace breaks the pattern but that the service itself publishes.
# Empty until one is confirmed against the live registry.
OFFICIAL_APPS: frozenset[str] = frozenset()

EXPERT_VENDORS: frozenset[str] = frozenset(
    {
        "claude-acp",
        "codex-acp",
        "gemini",
        "github-copilot-cli",
        "cursor",
        "junie",
        "goose",
        "kimi",
    }
)

# Registry ids looked up for the Popular row; Home drops any that is absent, not Official, or
# cannot be connected in one click here.
POPULAR: tuple[str, ...] = (
    "com.notion/mcp",
    "app.linear/mcp",
    "com.atlassian/atlassian-mcp-server",
    "com.asana/mcp",
)


def namespace(entry_id: str) -> str:
    return entry_id.partition("/")[0]


def _labels(entry_id: str) -> list[str]:
    return namespace(entry_id).split(".")


def service_key(entry_id: str) -> str:
    """The service's name: the second label (`com.notion` -> `notion`, `io.github.bob` -> `bob`)."""
    labels = _labels(entry_id)
    return labels[-1] if len(labels) == 2 else labels[min(2, len(labels) - 1)]


# Words in an entry's own name that do not name another service.
_GENERIC = frozenset({"mcp", "server", "remote", "official", "hosted"})


def is_official_app(entry_id: str) -> bool:
    """Official: the allowlist, or a two-label namespace (a reversed registrable domain) whose
    entry is about that domain's own service. A third party publishes under its own domain for
    someone else's service (`com.mcparmory/notion`), so the name after the slash may hold only
    the domain's label and generic words (`com.notion/mcp`,
    `com.atlassian/atlassian-mcp-server`)."""
    if entry_id in OFFICIAL_APPS:
        return True
    labels = _labels(entry_id)
    if "/" not in entry_id or len(labels) != 2 or not all(labels):
        # A third label (`com.notion.evil`) is a subdomain anyone with that host can claim.
        return False
    words = set(re.split(r"[^a-z0-9]+", entry_id.partition("/")[2].lower())) - {""}
    return not words - _GENERIC - {labels[1].lower()}


def is_official_expert(expert_id: str) -> bool:
    return expert_id in EXPERT_VENDORS


def publisher(entry_id: str, repo: str) -> str:
    ns = namespace(entry_id)
    return repo or ns if ns.startswith("io.github.") else ns
