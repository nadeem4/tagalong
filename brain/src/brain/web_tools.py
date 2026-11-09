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


NOTE_MAX_ITEMS = 5  # queries, fetched pages and sources each
NOTE_MAX_TEXT = 120  # characters of one query, title or url


def _clip(value: object) -> str:
    return " ".join(str(value).split())[:NOTE_MAX_TEXT]


def _search_note(blocks: list[dict]) -> str:
    """One short line saying what Anthropic's search and fetch tools did in a message, so the
    saved chat still shows it after the blocks themselves are dropped. Empty when none ran."""
    queries: list[str] = []
    fetched: list[str] = []
    sources: list[str] = []
    for b in blocks:
        kind, body = b.get("type"), b.get("content")
        if kind == "server_tool_use" and isinstance(b.get("input"), dict):
            if b.get("name") == "web_search" and b["input"].get("query"):
                queries.append(_clip(b["input"]["query"]))
            elif b.get("name") == "web_fetch" and b["input"].get("url"):
                fetched.append(_clip(b["input"]["url"]))
        elif kind == "web_search_tool_result" and isinstance(body, list):
            for r in body:  # an error result is a dict, not a list: no sources
                if isinstance(r, dict) and r.get("url"):
                    sources.append(f"{_clip(r.get('title') or 'page')} ({_clip(r['url'])})")
    parts = []
    if queries:
        quoted = ", ".join(f'"{q}"' for q in queries[:NOTE_MAX_ITEMS])
        parts.append(f"Searched the web for {quoted}")
    if fetched:
        parts.append("Read " + ", ".join(fetched[:NOTE_MAX_ITEMS]))
    if sources:
        parts.append("Sources: " + "; ".join(dict.fromkeys(sources[:NOTE_MAX_ITEMS])))
    return f"[{'. '.join(parts)}.]" if parts else ""


def without_server_blocks(message: dict) -> dict:
    """The copy of an assistant message that is saved: text only, no results, no citations, and
    one short note in place of the dropped search blocks so a restarted Scout still knows it
    searched. Dropping server blocks leaves a hole between thinking blocks, so thinking goes
    too. A message with nothing to drop comes back as the same object."""
    content = message["content"]
    if message["role"] != "assistant" or not isinstance(content, list):
        return message
    if any(is_server_block(b) for b in content):
        content = without_thinking(content)
    kept: list[dict] = []
    noted = False
    for b in content:
        if not is_server_block(b):
            kept.append({k: v for k, v in b.items() if k != "citations"})
        elif not noted and (note := _search_note(content)):
            kept.append({"type": "text", "text": note})  # where the first dropped block was
            noted = True
    return message if kept == message["content"] else {**message, "content": kept}
