"""Scout's web search and fetch: Anthropic's server-side tools, declared next to its own.

Anthropic runs them and returns the results inside the same reply, so the brain never calls
them. They are still ToolSpecs, so Home lists them, Off hides them and the capability picture
names them. Each search costs a fee that the budget counts (see guardrails.WEB_SEARCH_USD).
"""

from brain.mind.turn import Call
from brain.protocol import ErrorCode, RpcError
from brain.toolbox import ToolSpec

# Searches or fetches the model may make in one request. Each pause_turn continuation is a new
# request, so the real limit per question is the step cap times this.
MAX_USES = 5


def is_server_block(block: dict) -> bool:
    """A block Anthropic ran, by shape so new tool versions need no list edit: server_tool_use
    and every <name>_tool_result (web_search, web_fetch, code_execution, tool_search ...). Only
    our own client results are exactly "tool_result". Results can be pages long and only replay
    inside the live conversation; one left without its use makes the API reject every request."""
    kind = block.get("type")
    if not isinstance(kind, str):
        return False
    return kind.endswith(("_tool_use", "_tool_result")) and kind not in ("tool_use", "tool_result")


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


def without_thinking(content: list[dict]) -> list[dict]:
    """The blocks minus every thinking and redacted_thinking block. The API accepts a reply
    with no thinking, but rejects a run with a hole in it (one block edited or dropped), so a
    message that loses any block must lose all of them."""
    return [b for b in content if b.get("type") not in ("thinking", "redacted_thinking")]


def without_server_blocks(message: dict) -> dict:
    """The copy of an assistant message that is saved: text only, no results, no citations.
    Dropping server blocks leaves a hole between thinking blocks, so thinking goes too. A
    message with nothing to drop comes back as the same object."""
    content = message["content"]
    if message["role"] != "assistant" or not isinstance(content, list):
        return message
    if any(is_server_block(b) for b in content):
        content = without_thinking(content)
    kept = [
        {k: v for k, v in b.items() if k != "citations"} for b in content if not is_server_block(b)
    ]
    return message if kept == message["content"] else {**message, "content": kept}
