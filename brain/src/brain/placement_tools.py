"""Home's tools to read and set where an app or expert runs. Home only: Scout must not move a tool
to another machine. A placement is not a permission; the rules for the tool are unchanged.
"""

import json
from collections.abc import Awaitable, Callable

from brain.placements import Placement, Placements
from brain.protocol import ErrorCode, RpcError
from brain.toolbox import Handler, ToolSpec

_HOME = frozenset({"home"})
KINDS = ("expert", "app")


def placement_tools(
    placements: Placements,
    app_ids: Callable[[], list[str]],
    relocate_app: Callable[[str], Awaitable[None]],
    notify: Callable[[str, dict], None],
) -> list[tuple[ToolSpec, Handler]]:
    def refuse(message: str) -> RpcError:
        return RpcError(ErrorCode.invalid_params, message)

    async def placement_list(args: dict) -> str:
        rows = [
            {"kind": kind, "id": target, **vars(place)}
            for kind in KINDS
            for target, place in placements.all(kind).items()
        ]
        return json.dumps({"placements": rows})

    async def placement_set(args: dict) -> str:
        kind, target = args.get("kind"), args.get("id")
        if kind not in KINDS or not isinstance(target, str):
            raise refuse("kind must be expert or app, with the id of one.")
        if kind == "app" and target not in app_ids():
            raise refuse(f"There is no app called {target}.")
        try:
            place = Placement(args.get("mode", ""), args.get("body_id"), args.get("prefer"))
        except ValueError as err:
            raise refuse(str(err)) from None
        placements.set(kind, target, place)
        if kind == "app":
            await relocate_app(target)
        notify("changed", {"what": "placements"})
        return json.dumps({"kind": kind, "id": target, **vars(place)})

    set_schema = {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": list(KINDS)},
            "id": {"type": "string"},
            "mode": {"type": "string", "enum": ["brain", "body", "both"]},
            "body_id": {"type": "string"},
            "prefer": {"type": "string", "enum": ["body", "brain", "ask"]},
        },
        "required": ["kind", "id", "mode"],
    }
    return [
        (
            ToolSpec(
                "placement_list",
                "Where each expert and app runs, when it was set.",
                {"type": "object", "properties": {}},
                _HOME,
                effect="read",
            ),
            placement_list,
        ),
        (
            ToolSpec(
                "placement_set",
                "Choose where an expert or app runs: the brain, one body, or both with a "
                "preference (body, brain or ask).",
                set_schema,
                _HOME,
                effect="change",
            ),
            placement_set,
        ),
    ]
