"""stt_state and set_stt for Home's Voice page: which speech models write down what is said.

Home-only tools, like model_tools. The choice is saved at once; a change tells Home and the ears
to load the new models on the next listen (a session already running keeps the ones it has).
"""

import asyncio
import json
import sqlite3
from collections.abc import Callable

from brain.protocol import ErrorCode, RpcError
from brain.toolbox import Handler, ToolSpec
from brain.voice import stt_choice
from brain.voice.stt import load_models

Notify = Callable[[str, dict], None]


def stt_tools(
    db: sqlite3.Connection,
    env: tuple[str | None, str | None],
    notify: Notify,
    reload: Callable[[], None],
) -> list[tuple[ToolSpec, Handler]]:
    def choice() -> dict:
        return {
            "live": stt_choice.chosen_live(db, env[0]),
            "final": stt_choice.chosen_final(db, env[1]),
        }

    async def stt_state(args: dict) -> str:
        models = [
            {
                "id": m.id,
                "label": m.label,
                "role": m.role,
                "size_mb": m.size_mb,
                "gpu": m.gpu,
                "languages": list(m.languages),
                "note": m.note,
            }
            for m in load_models()
        ]
        # nvidia-smi is a process: off the loop, and it has its own short timeout.
        card = await asyncio.to_thread(stt_choice.gpu_name)
        return json.dumps({**choice(), "models": models, "gpu_name": card})

    async def set_stt(args: dict) -> str:
        live, final = args.get("live"), args.get("final")
        ok = (live is not None or final is not None) and (
            live is None or (isinstance(live, str) and stt_choice.valid_live(live))
        )
        ok = ok and (final is None or (isinstance(final, str) and stt_choice.valid_final(final)))
        if not ok:
            raise RpcError(
                ErrorCode.invalid_params, "set_stt needs a listed live and/or final speech model."
            )
        if live is not None:
            stt_choice.save_live(db, live)
        if final is not None:
            stt_choice.save_final(db, final)
        reload()
        notify("changed", {"what": "stt"})
        return json.dumps(choice())

    home = frozenset({"home"})
    return [
        (
            ToolSpec(
                "stt_state",
                "The speech models that write down what you say, the choice, and the graphics "
                "card Scout can see.",
                {"type": "object", "properties": {}},
                home,
                effect="read",
            ),
            stt_state,
        ),
        (
            ToolSpec(
                "set_stt",
                "Choose the speech models: live (while you talk) and final (when you finish), "
                "each a listed id or auto; final can also be off. Applies from the next listen.",
                {
                    "type": "object",
                    "properties": {"live": {"type": "string"}, "final": {"type": "string"}},
                },
                home,
                effect="change",
            ),
            set_stt,
        ),
    ]
