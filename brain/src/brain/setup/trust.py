"""Who counts as Official: an app whose registry namespace is the service's own reversed domain.

The registry proves a namespace by DNS or HTTP, so `com.notion` is Notion's; a GitHub login
(`io.github.*`) proves only who the user is, so it never counts. Experts are Official only when
the vendor is on a short allowlist. Everything else is Community.
"""

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
    "com.atlassian/mcp",
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


def is_official_app(entry_id: str) -> bool:
    if entry_id in OFFICIAL_APPS:
        return True
    # Exactly two non-empty labels: a reversed registrable domain. A third label
    # (`com.notion.evil`) is a subdomain anyone with that host could claim, so it is Community.
    labels = _labels(entry_id)
    return "/" in entry_id and len(labels) == 2 and all(labels)


def is_official_expert(expert_id: str) -> bool:
    return expert_id in EXPERT_VENDORS


def publisher(entry_id: str, repo: str) -> str:
    ns = namespace(entry_id)
    return repo or ns if ns.startswith("io.github.") else ns
