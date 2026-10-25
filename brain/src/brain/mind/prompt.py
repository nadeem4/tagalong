"""Builds the system prompt and the user message the model sees on each turn.

Kept pure so the prompt is stable between calls in the same minute (cache friendly)
and so the Session can call these without any I/O of its own.
"""

import base64
import json
from datetime import datetime
from functools import cache
from importlib.resources import files
from typing import Any

from brain.protocol import Body, FilePart, ImagePart, SayParams, TextPart


@cache
def _soul() -> str:
    return files("brain.mind").joinpath("soul.md").read_text(encoding="utf-8").strip()


def system_prompt(now: datetime, bodies: list[Body]) -> str:
    if bodies:
        lines = [f"- {b.id} ({b.kind}): {b.name}" for b in sorted(bodies, key=lambda b: b.id)]
        online = "Bodies online:\n" + "\n".join(lines)
    else:
        online = "Bodies online: no body is connected."
    return "\n\n".join([_soul(), f"Now: {now.strftime('%A %d %B %Y, %H:%M')}", online])


def _text(text: str) -> dict[str, Any]:
    return {"type": "text", "text": text}


def _source(mime: str, data: str) -> dict[str, str]:
    return {"type": "base64", "media_type": mime, "data": data}


def _file_block(part: FilePart) -> dict[str, Any]:
    if part.mime == "application/pdf":
        return {"type": "document", "source": _source(part.mime, part.data)}
    name = part.name or "unnamed"
    if part.mime.startswith("text/"):
        body = base64.b64decode(part.data).decode("utf-8", errors="replace")
        return _text(f"File {name}:\n{body}")
    return _text(f"File {name} ({part.mime}) attached; it cannot be read here.")


def user_content(params: SayParams) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    if params.text:
        blocks.append(_text(params.text))
    for part in params.parts or []:
        if isinstance(part, TextPart):
            blocks.append(_text(part.text))
        elif isinstance(part, ImagePart):
            blocks.append({"type": "image", "source": _source(part.mime, part.data)})
        elif isinstance(part, FilePart):
            blocks.append(_file_block(part))
    if params.context is not None:
        blocks.append(_text("Context from the body (as sent):\n" + json.dumps(params.context)))
    if not blocks:
        raise ValueError("say has no content")
    return blocks
