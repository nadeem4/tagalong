"""Home's loops tools: the "Read my mail for loops" switch, the Held list, forget and wipe.

Home-only (the model never sees them). The switch is the person's consent, so `loops_set` is
the one place mail reading starts. A row carries what a loop is (title, asks, direction, due,
people, status) and never the mail it came from: the brain does not keep the body.
"""

import json
from collections.abc import Callable

from brain.loops.service import LoopService
from brain.protocol import ErrorCode, RpcError
from brain.toolbox import Handler, ToolSpec

_NO_ARGS = {"type": "object", "properties": {}}


def loop_home_tools(
    service: LoopService, apps: Callable[[], list[tuple[str, str]]]
) -> list[tuple[ToolSpec, Handler]]:
    """`apps` lists every connected app as (id, name); only the mail ones are offered."""
    home = frozenset({"home"})

    def refuse(message: str) -> RpcError:
        return RpcError(ErrorCode.invalid_params, message)

    def mail_apps() -> list[dict]:
        out = []
        for app_id, name in apps():
            if not (service.is_on(app_id) or service.can_read(app_id)):
                continue  # an app that is on stays listed even while it cannot be read
            row: dict = {"id": app_id, "name": name, "on": service.is_on(app_id)}
            since = service.unread_since(app_id)
            if since is not None:
                row["unread_since"] = since.isoformat()
            out.append(row)
        return out

    async def state(_args: dict) -> str:
        loops = [
            {
                "id": lp.id,
                "app": lp.source,
                "title": lp.title,
                "asks": lp.asks,
                "direction": lp.direction,
                "due": lp.due.isoformat() if lp.due else None,
                "people": lp.people,
                "status": lp.status,
            }
            for lp in service.all_loops()
        ]
        return json.dumps({"apps": mail_apps(), "loops": loops})

    async def set_switch(args: dict) -> str:
        app, on = args.get("app"), args.get("on")
        if not isinstance(app, str) or not isinstance(on, bool):
            raise refuse("app is an app id and on is true or false.")
        if on:
            try:
                service.enable(app)
            except ValueError as err:
                raise refuse(str(err)) from err
        else:
            service.disable(app)
        return json.dumps({"app": app, "on": on})

    async def forget(args: dict) -> str:
        loop_id = args.get("id")
        if not isinstance(loop_id, str) or not service.forget(loop_id):
            raise refuse(f"There is no loop {loop_id}.")
        return json.dumps({"id": loop_id})

    async def wipe(_args: dict) -> str:
        service.wipe()
        return json.dumps({"wiped": True})

    def spec(name: str, text: str, props: dict, effect: str) -> ToolSpec:
        schema = {"type": "object", "properties": props, "required": list(props)}
        return ToolSpec(name, text, schema if props else _NO_ARGS, home, effect=effect)  # type: ignore[arg-type]

    return [
        (
            spec(
                "loops_state",
                "The mail apps the loops switch is offered for (on or off, and when mail stopped "
                "being read) and every loop held.",
                {},
                "read",
            ),
            state,
        ),
        (
            spec(
                "loops_set",
                "Switch reading one mail app for loops on or off. Off keeps the loops held.",
                {"app": {"type": "string"}, "on": {"type": "boolean"}},
                "change",
            ),
            set_switch,
        ),
        (
            spec("loop_forget", "Delete one held loop.", {"id": {"type": "string"}}, "change"),
            forget,
        ),
        (
            spec(
                "loops_wipe",
                "Stop and wipe: every switch off, every loop and every mail cursor deleted.",
                {},
                "change",
            ),
            wipe,
        ),
    ]
