"""tts_state and set_tts for Home's Voice page: which voice Scout speaks with.

Home-only tools, like stt_tools. The choice is saved at once; `on_pick` tells the mouth, which
keeps speaking in the ready voice while the new one downloads.
"""

import asyncio
import json
import sqlite3
from collections.abc import Callable
from pathlib import Path

from brain.protocol import ErrorCode, RpcError
from brain.toolbox import Handler, ToolSpec
from brain.voice import tts_choice
from brain.voice.models import present
from brain.voice.tts import load_voices

Notify = Callable[[str, dict], None]


def tts_tools(
    db: sqlite3.Connection,
    notify: Notify,
    on_pick: Callable[[str], None],
    folder: Path,
    download: Callable[[], dict],
) -> list[tuple[ToolSpec, Handler]]:
    """`folder` is the voice folder (installed means every file there and verified);
    `download` is the mouth's current fetch, for the status line."""

    async def tts_state(args: dict) -> str:
        # Hashing the installed files is disk work: off the loop.
        voices = await asyncio.to_thread(
            lambda: [
                {
                    "id": v.id,
                    "label": v.label,
                    "descriptor": v.descriptor,
                    "engine": v.engine,
                    "size_mb": v.size_mb,
                    "licence": v.licence,
                    "installed": present(folder, v.files),
                    "sample": v.sample is not None,
                }
                for v in load_voices()
            ]
        )
        return json.dumps(
            {
                "chosen": tts_choice.chosen(db),
                "resolved": tts_choice.resolved(db).id,
                "voices": voices,
                "download": download(),
            }
        )

    async def set_tts(args: dict) -> str:
        voice = args.get("voice")
        if not isinstance(voice, str) or not tts_choice.valid(voice):
            raise RpcError(ErrorCode.invalid_params, "set_tts needs a listed voice or auto.")
        tts_choice.save(db, voice)
        resolved = tts_choice.resolved(db).id
        on_pick(resolved)
        notify("changed", {"what": "tts"})
        return json.dumps({"chosen": voice, "resolved": resolved})

    home = frozenset({"home"})
    return [
        (
            ToolSpec(
                "tts_state",
                "The voices Scout can speak with, which is chosen, which are installed, and "
                "the current download.",
                {"type": "object", "properties": {}},
                home,
                effect="read",
            ),
            tts_state,
        ),
        (
            ToolSpec(
                "set_tts",
                "Choose the voice Scout speaks with: a listed id or auto. It downloads if "
                "needed and Scout keeps speaking in the ready voice meanwhile.",
                {
                    "type": "object",
                    "properties": {"voice": {"type": "string"}},
                    "required": ["voice"],
                },
                home,
                effect="change",
            ),
            set_tts,
        ),
    ]
