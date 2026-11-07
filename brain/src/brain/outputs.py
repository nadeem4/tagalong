"""Long tool output as a capped preview: the model sees the start and reads the rest by id.

The cap is a transport guardrail in characters, not a presentation rule: what to say about a
long result is Scout's call. The full text is stored masked (the newest TAGALONG_OUTPUTS_KEEP are
kept) so a `read_output` page can never show a secret. Cuts are on code points, not mid-character.
"""

import json
import uuid
from dataclasses import dataclass

from brain.guards import Guards
from brain.masking import mask_json
from brain.memory import Memory


@dataclass(frozen=True)
class StoredOutput:
    id: str
    tool: str
    chars: int  # of the masked copy, which is what offsets count


class OutputStore:
    def __init__(self, memory: Memory, guards: Guards, cap: int) -> None:
        self._memory = memory
        self._guards = guards
        self.cap = cap

    def put(self, tool: str, text: str) -> StoredOutput:
        masked = mask_json(self._guards, "tool_output", text)
        output_id = uuid.uuid4().hex[:12]
        self._memory.put_output(output_id, tool, masked)
        return StoredOutput(output_id, tool, len(masked))

    def page(self, output_id: str, offset: int, length: int | None = None) -> dict:
        """At most `cap` characters from `offset`. Raises ValueError (a plain line for the model)
        for an unknown id or a negative offset; an offset past the end is an empty last page."""
        if offset < 0:
            raise ValueError("offset must be 0 or more.")
        text = self._memory.get_output(output_id)
        if text is None:
            raise ValueError(f"No stored output with id {output_id}.")
        size = self.cap if length is None else max(1, min(length, self.cap))
        # `length` may ask for more than a page; one page is never above the cap.
        end = offset + size
        return {
            "id": output_id,
            "text": text[offset:end],
            "offset": offset,
            "next_offset": end if end < len(text) else None,
            "chars": len(text),
        }

    def prune(self, keep: int) -> None:
        self._memory.prune_outputs(keep)


def preview(store: OutputStore, tool: str, text: str, readable: bool = True) -> str:
    """`text` untouched when within the cap; otherwise a facts header and the first `cap`
    characters of the masked copy, which is stored whole. readable=False is for a reader
    that cannot call read_output (an expert): no id or offset, only that it was cut."""
    if len(text) <= store.cap:
        return text
    stored = store.put(tool, text)
    shown = store.page(stored.id, 0)
    if not readable:
        facts = {"chars": stored.chars, "shown": len(shown["text"]), "truncated": True}
        return json.dumps(facts) + "\n" + shown["text"]
    facts = {
        "output_id": stored.id,
        "chars": stored.chars,
        "shown": len(shown["text"]),
        "next_offset": shown["next_offset"],
    }
    return json.dumps(facts) + "\n" + shown["text"]
