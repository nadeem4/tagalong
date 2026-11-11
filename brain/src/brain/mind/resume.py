"""Rebuilds a valid Anthropic message history from messages saved before a restart.

Always cuts on whole turns so no tool_result is left without its tool_use, and answers a
tool_use left hanging by a crash so the API accepts the next request. Also drops server-side
tool blocks, so chats saved with orphaned results heal. Drops all thinking too: the API only
accepts thinking blocks cut from the front of a history, so none at all is the safe rebuild.
A reply left empty by that (a silent wake) goes with the message it answered: a stand-in text
would be copied by the model as if it were a real reply.
"""

from brain.web_tools import without_server_blocks, without_thinking

RESUME_MAX_MESSAGES = 50


def _without_server_blocks(message: dict) -> dict:
    """Heals saved chats that kept server blocks, by the same strip the save path uses. An
    assistant message may come back empty; `_without_silent_replies` removes it."""
    out = without_server_blocks(message)
    if out["role"] == "assistant" and isinstance(out["content"], list):
        out = {**out, "content": without_thinking(out["content"])}
    if out["content"] == message["content"]:
        return message  # unchanged: callers tell a rebuilt tail from a loaded one by identity
    return out


def _without_silent_replies(history: list[dict]) -> list[dict]:
    """Drops empty assistant replies with the turn-start message each one answered, so roles
    still alternate. After a tool round only the empty reply goes."""
    kept: list[dict] = []
    for m in history:
        silent = m["role"] == "assistant" and isinstance(m["content"], list) and not m["content"]
        if not silent:
            kept.append(m)
        elif kept and _is_turn_start(kept[-1]):
            kept.pop()
    return kept


def _is_turn_start(message: dict) -> bool:
    if message["role"] != "user":
        return False
    content = message["content"]
    if isinstance(content, str):
        return True
    return not any(b.get("type") == "tool_result" for b in content)


def _has_compaction(message: dict) -> bool:
    content = message["content"]
    return (
        message["role"] == "assistant"
        and isinstance(content, list)
        # A failed compaction has content None and the server ignores it, so it is no cut point.
        and any(b.get("type") == "compaction" and b.get("content") for b in content)
    )


def rebuild_history(messages: list[dict]) -> list[dict]:
    return rebuild_with_flag(messages)[0]


def rebuild_with_flag(messages: list[dict]) -> tuple[list[dict], bool]:
    """The rebuilt history, and whether it ends in a cancelled tool_result added here (so not
    yet in the saved chat)."""
    start = 0
    marks = [i for i, m in enumerate(messages) if _has_compaction(m)]
    if marks:
        start = marks[-1]
        while start > 0 and not _is_turn_start(messages[start]):
            start -= 1
    history = _without_silent_replies([_without_server_blocks(m) for m in messages[start:]])

    if len(history) > RESUME_MAX_MESSAGES:
        cut = next(
            (
                i
                for i in range(len(history) - RESUME_MAX_MESSAGES, len(history))
                if _is_turn_start(history[i])
            ),
            None,
        )
        if cut is None:
            # The newest turn alone is over the cap: keep it whole; server-side compaction
            # bounds its size.
            cut = max(i for i, m in enumerate(history) if _is_turn_start(m))
        history = history[cut:]

    added = False
    last = history[-1] if history else None
    if last and last["role"] == "assistant" and isinstance(last["content"], list):
        calls = [b for b in last["content"] if b.get("type") == "tool_use"]
        if calls:
            added = True
            history.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": c["id"],
                            "content": "cancelled",
                            "is_error": True,
                        }
                        for c in calls
                    ],
                }
            )
    return history, added
