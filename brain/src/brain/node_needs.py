"""What a node cannot do for itself: be approved, have an expert installed, or have a tool
signed in. The brain only asks. It tells the desktop beside the node (the one on the same device
token) what it is waiting for and acts on the person's answer from that desktop alone. The yes
itself is written on the node's machine by the person's own CLI, so nothing here touches the
node's list.

An app that stays on the brain asks too: its web sign-in returns to the desktop's PC, so the
desktop catches the redirect and sends back only the one-time code.
"""

import asyncio
import logging
import random
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

from brain.app_oauth import OAuthError
from brain.bodies import Bodies
from brain.pipes import Pipe
from brain.protocol import ErrorCode, NodeAnsweredParams, PipeSpec, RpcError

log = logging.getLogger("brain")

_ASKS_PER_PIPE = 2
_EXCHANGE_S = 25  # under the desktop's own wait for the brain

type Need = Literal["approve", "install", "signin", "app_signin"]


@dataclass
class _Open:
    desktop: str
    node: str | None
    need: Need
    key: tuple
    reply: asyncio.Future[NodeAnsweredParams | None] = field(
        default_factory=lambda: asyncio.get_running_loop().create_future()
    )
    # An app sign-in: how the code's exchange ended (None for success, else the plain reason).
    exchanged: asyncio.Future[str | None] = field(
        default_factory=lambda: asyncio.get_running_loop().create_future()
    )


class RemoteSignin:
    """One app's web sign-in carried out on a desktop's PC: the page opens there and its
    redirect lands there, so only the one-time code travels back."""

    def __init__(self, needs: "NodeNeeds", desktop: str, app: str) -> None:
        self._needs = needs
        self._desktop = desktop
        self._app = app
        self._url = ""
        self._port = 0

    async def start(self) -> str:
        # Nothing can be checked from here: the port is free or not on the desktop's PC. A busy
        # one is reported there, and the next sign-in draws another.
        self._port = random.randint(49152, 65535)
        return f"http://127.0.0.1:{self._port}/callback"

    async def open_url(self, url: str) -> None:
        self._url = url

    async def wait(self, timeout: float) -> tuple[str, str, str | None]:
        answer = await self._needs.ask(
            self._desktop,
            "app_signin",
            {"app": self._app, "url": self._url, "port": self._port},
            key=(self._desktop, "app_signin", self._app),
            wait_s=timeout,
        )
        if answer is None:
            raise OAuthError("The sign-in was not finished.")
        if answer.code is None:
            raise OAuthError("The sign-in sent back no code.")
        return answer.code, answer.state or "", answer.iss

    def finished(self, error: str | None) -> None:
        self._needs.exchanged(self._desktop, self._app, error)

    def close(self) -> None:
        pass


class NodeNeeds:
    def __init__(self, bodies: Bodies, wait_s: float = 600.0) -> None:
        self._bodies = bodies
        self._wait_s = wait_s
        self._open: dict[str, _Open] = {}

    async def open_pipe(self, node: str, spec: PipeSpec) -> Pipe:
        """Open a pipe on the node; when it refuses for want of a yes, or for want of an expert's
        install, ask the person at the desktop beside it and try again after each answer. A
        refusal the person does not clear stands, with the line to run on that machine."""
        asks = 0
        while True:
            try:
                return await self._bodies.open_pipe(node, spec)
            except RpcError as err:
                if err.code == ErrorCode.denied:
                    need: Need = "approve"
                elif err.code == ErrorCode.not_installed and spec.expert is not None:
                    need = "install"
                else:
                    raise
                asks += 1
                if asks > _ASKS_PER_PIPE or not await self._ask_node(node, need, spec):
                    if need == "install":
                        raise RpcError(
                            ErrorCode.not_installed,
                            f"{spec.expert} is not installed on {node}; "
                            f"run tagalong install {spec.expert} there",
                        ) from err
                    raise

    async def sign_in(self, node: str, expert: str) -> bool:
        """Ask for a sign-in on the node's machine; true once the person has done it."""
        return await self._ask_node(node, "signin", PipeSpec(expert=expert))

    async def answered(self, body_id: str, answer: NodeAnsweredParams) -> None:
        """A desktop's reply. Only the desktop the question went to is heard; "not now" fails the
        job waiting on it and leaves the question open, a yes ends it. A request the brain no
        longer holds is refused, so the desktop never reports a sign-in that was dropped. An app
        sign-in is answered once its code has been traded, with that outcome."""
        entry = self._open.get(answer.id)
        if entry is None or entry.desktop != body_id:
            raise RpcError(ErrorCode.not_found, "That request is no longer open.")
        if not entry.reply.done():
            entry.reply.set_result(answer if answer.outcome == "done" else None)
        if entry.need != "app_signin":
            if answer.outcome == "done":
                self._close(answer.id, "answered")
            return
        error = None
        if answer.outcome == "done":
            try:
                error = await asyncio.wait_for(asyncio.shield(entry.exchanged), _EXCHANGE_S)
            except TimeoutError:
                error = "The sign-in did not finish in time."
        self._close(answer.id, "answered")
        if error is not None:
            raise RpcError(ErrorCode.tool_failed, error)

    def exchanged(self, desktop: str, app: str, error: str | None) -> None:
        """An app sign-in's code was traded (or refused): tells the desktop still waiting."""
        for entry in self._open.values():
            if entry.key == (desktop, "app_signin", app) and not entry.exchanged.done():
                entry.exchanged.set_result(error)

    async def _ask_node(self, node: str, need: Need, spec: PipeSpec) -> bool:
        desktop = self._bodies.beside(node)
        if desktop is None:
            return False
        fields: dict[str, Any] = {"node": node, "spec": spec.model_dump(exclude_none=True)}
        if spec.expert is not None:
            fields["expert"] = spec.expert
        key = (node, need, spec.model_dump_json())
        return await self.ask(desktop, need, fields, key=key) is not None

    async def ask(
        self,
        desktop: str,
        need: Need,
        fields: dict[str, Any],
        *,
        key: tuple,
        wait_s: float | None = None,
    ) -> NodeAnsweredParams | None:
        for old_id, old in list(self._open.items()):
            if old.key == key:
                self._close(old_id, "replaced")
        need_id = uuid.uuid4().hex
        entry = self._open[need_id] = _Open(desktop, fields.get("node"), need, key)
        frame = {"id": need_id, "state": "open", "need": need, **fields}
        self._bodies.notify_one(desktop, "node_needs", frame)
        try:
            return await asyncio.wait_for(
                asyncio.shield(entry.reply), self._wait_s if wait_s is None else wait_s
            )
        except TimeoutError:
            self._close(need_id, "timeout")
            return None
        except asyncio.CancelledError:
            self._close(need_id, "gone")
            raise

    def _close(self, need_id: str, reason: str) -> None:
        entry = self._open.pop(need_id, None)
        if entry is None:
            return
        if not entry.reply.done():
            entry.reply.set_result(None)
        if not entry.exchanged.done():
            entry.exchanged.set_result("The sign-in was ended.")
        self._bodies.notify_one(
            entry.desktop, "node_needs", {"id": need_id, "state": "closed", "reason": reason}
        )

    def node_gone(self, body_id: str) -> None:
        for need_id, entry in list(self._open.items()):
            if body_id in (entry.node, entry.desktop):
                self._close(need_id, "gone")
