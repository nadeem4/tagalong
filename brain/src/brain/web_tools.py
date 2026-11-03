"""Scout's web search and fetch: Anthropic's server-side tools, declared next to its own.

Anthropic runs them and returns the results inside the same reply, so the brain never calls
them. They are still ToolSpecs, so Home lists them, Off hides them and the capability picture
names them. Each search costs a fee that the budget counts (see guardrails.WEB_SEARCH_USD).
"""

from brain.mind.turn import Call
from brain.protocol import ErrorCode, RpcError
from brain.toolbox import ToolSpec

# Searches or fetches the model may make in one request; a cap on cost per question.
MAX_USES = 5

# What a saved turn must not keep: the results can be pages long, and their encrypted parts
# only replay inside the live conversation.
_SERVER_BLOCKS = frozenset({"server_tool_use", "web_search_tool_result", "web_fetch_tool_result"})


def _spec(name: str, version: str, description: str) -> ToolSpec:
    return ToolSpec(
        name,
        description,
        {},
        effect="read",
        default_mode="auto",
        server_tool={"type": f"{name}_{version}", "name": name, "max_uses": MAX_USES},
    )


SPECS = [
    _spec("web_search", "20260209", "Search the web for current information."),
    _spec("web_fetch", "20260209", "Read a web page the owner or a search result gave a link to."),
]


class WebSource:
    approval_source = "scout_tool"

    def specs(self) -> list[ToolSpec]:
        return list(SPECS)

    def known_specs(self) -> list[ToolSpec]:
        return self.specs()

    async def run(self, call: Call, tool: str) -> str | list[dict]:
        raise RpcError(ErrorCode.unknown_tool, f"{tool} runs on Anthropic's side, not here.")

    def unavailable(self, name: str) -> RpcError | None:
        return None


def without_server_blocks(message: dict) -> dict:
    """The copy of an assistant message that is saved: text only, no results, no citations."""
    content = message["content"]
    if message["role"] != "assistant" or not isinstance(content, list):
        return message
    kept = [
        {k: v for k, v in b.items() if k != "citations"}
        for b in content
        if b.get("type") not in _SERVER_BLOCKS
    ]
    return {**message, "content": kept}
