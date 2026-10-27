"""Rebuilds a valid Anthropic message history from messages saved before a restart.

Always cuts on whole turns so no tool_result is left without its tool_use, and answers a
tool_use left hanging by a crash so the API accepts the next request.
"""

RESUME_MAX_MESSAGES = 50


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
    start = 0
    marks = [i for i, m in enumerate(messages) if _has_compaction(m)]
    if marks:
        start = marks[-1]
        while start > 0 and not _is_turn_start(messages[start]):
            start -= 1
    history = list(messages[start:])

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

    last = history[-1] if history else None
    if last and last["role"] == "assistant" and isinstance(last["content"], list):
        calls = [b for b in last["content"] if b.get("type") == "tool_use"]
        if calls:
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
    return history
