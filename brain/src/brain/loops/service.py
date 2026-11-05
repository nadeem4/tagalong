"""LoopService: wakes Scout when a held loop matters, and reads mail while the switch is on.

Code decides when; Scout decides whether and what to say. A loop surfaces on context (the
window or tab matches an anchor), its due time, urgent mail, a quiet they-owe, or a stale
sweep. Each surface is recorded in the store (so a restart or a second focus never repeats
it) and goes through the same event path timers use; context, urgent and quiet are also
throttled per reason. The arming mirrors Timers: one call_later, re-checked at least hourly.
Mail: `enable(app)` starts a poll per app (the first poll reads the last 14 days, unanswered
only, until it finishes; then a cursor keeps place); each mail goes through the pre-filter and
the reader into the store; the person's own sent mail closes an "I owe" loop in code.
Read-only: nothing here changes a mailbox.
"""

import asyncio
import logging
from collections.abc import Callable
from datetime import datetime, timedelta

from brain.events import Event
from brain.loops.loop import Loop
from brain.loops.reader import Change, MailItem, Reader, ReaderStopped, prefilter
from brain.loops.source import Source
from brain.loops.sources.gmail import GmailSource
from brain.loops.store import LoopStore
from brain.loops.triggers import context, due, quiet, stale, urgent

log = logging.getLogger(__name__)

# Re-check at least hourly so a wall-clock change cannot strand the timer.
_MAX_SLEEP_S = 3600
_DUE_STATUSES = ("held", "snoozed", "stale")  # a stale loop's future due still fires
_OPEN = ("held", "surfaced", "snoozed", "stale")
_CONTEXT_STATUSES = ("held", "surfaced")  # a snoozed loop waits for its time, not for a window
# Per reason: (wakes, within seconds), counted across all loops, so Held cannot become noise.
# Due and stale are not here: a deadline must not be lost, and stale is one batched wake.
_THROTTLE = {"context": (1, 600), "urgent": (2, 3600), "quiet": (2, 3600)}
_URGENT_FRESH = timedelta(hours=24)  # a backfilled old mail flagged urgent is not urgent now
BACKFILL_DAYS = 14  # the first read goes this far back; a constant, not a setting
_FAILS_BEFORE_UNREAD = 3  # consecutive failed polls before "mail unread since" shows


class LoopService:
    def __init__(
        self,
        store: LoopStore,
        emit: Callable[..., None],
        now: Callable[[], datetime],
        reader: Reader | None = None,
        apps=None,  # Apps: builds the mail source for a connected app on `enable`
        poll_s: float = 300,
        stale_days: int = 7,
    ) -> None:
        self._store = store
        self._emit = emit
        self._now = now
        self._reader = reader
        self._apps = apps
        self._poll_s = poll_s
        self._stale_days = stale_days
        self._sent: dict[str, list[datetime]] = {}  # reason -> recent wakes, for throttles
        self._handle: asyncio.TimerHandle | None = None
        self._sources: dict[str, Source] = {}
        self._polls: dict[str, asyncio.TimerHandle] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._fails: dict[str, int] = {}
        self._unread: dict[str, datetime] = {}

    def start(self) -> None:
        self.fire_due()

    def changed(self) -> None:
        """Call after loops are added or edited, so the timer covers the earliest due."""
        self.fire_due()

    def fire_due(self) -> None:
        """Announce what has come due or gone quiet, sweep stale loops, and arm the next time."""
        now = self._now()
        waiting = self._with_status(_DUE_STATUSES)
        for loop in due.pending(waiting):
            if loop.due <= now:  # type: ignore[operator]
                self._surface(loop, "due", due.anchor(loop))
        for loop in quiet.ripe(waiting, now):
            if self._take("quiet"):
                self._surface(loop, "quiet", quiet.anchor(loop))
        self._sweep_stale(now)
        self._arm()

    def saw(self, event: Event) -> None:
        """A focus or tab event: surface a held loop whose anchor matches the window or page.

        One loop per anchor per local day, one wake per throttle window. A throttled match is
        not used up, so it can still surface on a later focus."""
        if event.kind not in ("focus", "tab"):
            return
        app, title, url = (str(event.facts.get(k) or "") for k in ("app", "title", "url"))
        if context.mail_in_front(app, title, url):
            return
        today = self._today()
        for loop in self._with_status(_CONTEXT_STATUSES):
            anchor = context.find(loop, title, url)
            if anchor is None or loop.surfaced.get(f"ctx:{anchor}") == today:
                continue
            if self._take("context"):
                self._surface(loop, "context", f"ctx:{anchor}", {"anchor": anchor})
            return

    def _surface(
        self, loop: Loop, reason: str, key: str, extra: dict[str, str | int] | None = None
    ) -> None:
        # Marked before emitting: a crash after this loses one wake, never repeats it.
        self._store.mark_surfaced(loop.id, key, self._today())
        facts = {**self._facts(loop, reason), **(extra or {})}
        self._emit(Event("loop", facts, key=f"loop:{loop.id}"))

    def _take(self, reason: str) -> bool:
        """Whether this reason may wake now; if so, counts it."""
        limit, within = _THROTTLE[reason]
        now = self._now()
        recent = [t for t in self._sent.get(reason, []) if (now - t).total_seconds() < within]
        if len(recent) >= limit:
            self._sent[reason] = recent
            return False
        self._sent[reason] = [*recent, now]
        return True

    def _free_at(self, reason: str) -> datetime | None:
        """When a throttled reason may wake again; None when it may now."""
        limit, within = _THROTTLE[reason]
        now = self._now()
        recent = [t for t in self._sent.get(reason, []) if (now - t).total_seconds() < within]
        if len(recent) < limit:
            return None
        return recent[len(recent) - limit] + timedelta(seconds=within)

    def _sweep_stale(self, now: datetime) -> None:
        found = stale.ripe(self._store.list("held"), now, self._stale_days)
        if not found:
            return
        for loop in found:
            self._store.set_status(loop.id, "stale")
        lines = "\n".join(f"{lp.id}: {lp.title} ({lp.asks})" for lp in found)
        facts: dict[str, str | int] = {"reason": "stale", "count": len(found), "loops": lines}
        self._emit(Event("loop", facts, key=f"loop-stale:{now.isoformat()}"))

    def _today(self) -> str:
        return self._now().astimezone().date().isoformat()  # the local day

    def _with_status(self, statuses: tuple[str, ...]) -> list[Loop]:
        return [lp for s in statuses for lp in self._store.list(s)]

    @staticmethod
    def _facts(loop: Loop, reason: str) -> dict[str, str | int]:
        facts: dict[str, str | int] = {
            "reason": reason,
            "id": loop.id,
            "title": loop.title,
            "asks": loop.asks,
            "direction": loop.direction,
        }
        if loop.people:
            facts["people"] = ", ".join(loop.people)
        if loop.due:
            facts["due"] = loop.due.isoformat()
        return facts

    def _arm(self) -> None:
        if self._handle is not None:
            self._handle.cancel()
            self._handle = None
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            return
        waiting = self._with_status(_DUE_STATUSES)
        now = self._now()
        free = self._free_at("quiet")  # a ripe quiet loop waits for the throttle, not a busy loop
        times = [lp.due for lp in due.pending(waiting)] + [
            max(lp.quiet_after, free) if free and lp.quiet_after <= now else lp.quiet_after  # type: ignore[type-var,operator]
            for lp in quiet.pending(waiting)
        ]
        if not times:
            return
        delay = (min(times) - now).total_seconds()  # type: ignore[type-var]
        self._handle = running.call_later(min(max(delay, 0), _MAX_SLEEP_S), self.fire_due)

    # --- mail ---

    def enable(self, app_id: str, source: Source | None = None) -> None:
        """Switch mail reading on for one app: the first poll runs now, then every poll_s."""
        if source is None:
            names = {t.name for t in self._apps.tools(app_id)} if self._apps else set()
            if not GmailSource.matches(names):
                raise ValueError(f"{app_id} is not a mail app Scout can read.")
            source = GmailSource(app_id, self._apps.call)  # direct: the switch is the consent
        self.disable(app_id)
        self._sources[app_id] = source
        self._schedule(app_id, 0)

    def disable(self, app_id: str) -> None:
        """Switch off: polling stops; loops already held stay."""
        self._sources.pop(app_id, None)
        handle = self._polls.pop(app_id, None)
        if handle:
            handle.cancel()
        task = self._tasks.pop(app_id, None)
        if task:
            task.cancel()

    def wipe(self) -> None:
        """Stop and wipe: every switch off, every loop and every cursor deleted."""
        for app_id in list(self._sources):
            self.disable(app_id)
        self._store.wipe()
        self._fails.clear()
        self._unread.clear()

    def unread_since(self, app_id: str) -> datetime | None:
        """When mail stopped being read (allowance spent or the app kept failing), if it has."""
        return self._unread.get(app_id)

    def polling(self, app_id: str) -> bool:
        task = self._tasks.get(app_id)
        return task is not None and not task.done()

    def _schedule(self, app_id: str, delay: float) -> None:
        self._polls[app_id] = asyncio.get_running_loop().call_later(delay, self._begin, app_id)

    def _begin(self, app_id: str) -> None:
        self._polls.pop(app_id, None)
        if app_id in self._sources:
            self._tasks[app_id] = asyncio.create_task(self._cycle(app_id))

    async def _cycle(self, app_id: str) -> None:
        try:
            await self.poll(app_id)
            self.fire_due()  # the poll tick also sweeps quiet and stale loops
        except Exception:  # a bad poll must not end the polling
            log.exception("loops poll failed for %s", app_id)
        finally:
            # Only the live task reschedules: a cancelled one (switched on again) would start a 2nd
            # chain.
            if app_id in self._sources and self._tasks.get(app_id) is asyncio.current_task():
                self._schedule(app_id, self._poll_s)

    async def poll(self, app_id: str) -> None:
        source = self._sources[app_id]
        cursor = self._store.cursor(app_id)
        now = self._now()
        since = datetime.fromisoformat(cursor) if cursor else now - timedelta(days=BACKFILL_DAYS)
        stopped = False
        try:
            items = await source.new_items(
                since, unanswered_only=not self._store.backfilled(app_id)
            )
            try:
                for item in items:
                    await self._process(app_id, item)
                    self._store.set_cursor(app_id, item.date.isoformat())
            except ReaderStopped:
                stopped = True
            if not stopped:
                self._store.set_backfilled(app_id)
                if cursor is None and not items:
                    self._store.set_cursor(app_id, now.isoformat())  # nothing waiting
            await self._close_replied(app_id, source, since, advance=not stopped)
        except Exception as exc:  # any failure counts; CancelledError is not an Exception
            self._fails[app_id] = self._fails.get(app_id, 0) + 1
            log.warning("loops poll of %s failed: %s", app_id, exc)
            if self._fails[app_id] >= _FAILS_BEFORE_UNREAD:
                self._unread.setdefault(app_id, now)
            return
        self._fails[app_id] = 0
        if stopped:
            self._unread.setdefault(app_id, now)
        else:
            self._unread.pop(app_id, None)

    async def _process(self, app_id: str, item: MailItem) -> None:
        if prefilter(item) or self._reader is None:
            return
        related = [lp for lp in self._open(app_id) if lp.ref == item.thread]
        change = await self._reader.read(item, related)
        if change.kind == "close":
            self._store.set_status(change.loop_id, "done")
            self._store.add_history(change.loop_id, f"closed: {change.reason}", item.date)
        elif change.kind == "update":
            current = self._store.get(change.loop_id)
            if current is not None:
                merged = self._merged(current, change)
                if merged.direction == "they_owe" and not change.quiet_after and merged.quiet_after:
                    # They wrote back: the old quiet time no longer means they have gone quiet.
                    # Marked before the save, whose re-check would otherwise fire it.
                    self._store.mark_surfaced(current.id, quiet.anchor(merged), self._today())
                self._save(merged, item)
        elif change.kind == "new":
            known = related[0] if related else None
            saved = self._save(self._from_change(item, change, known), item)
            fresh = item.date >= self._now() - _URGENT_FRESH
            if fresh and urgent.fresh(saved, change.urgent) and self._take("urgent"):
                self._surface(saved, "urgent", urgent.ANCHOR)

    def _save(self, loop: Loop, item: MailItem) -> Loop:
        saved = self._store.save(loop)
        if saved.status in ("done", "stale"):
            self._store.set_status(saved.id, "held")  # new mail on a finished thread reopens it
        self._store.add_history(saved.id, f"mail from {item.sender}", item.date)
        self.changed()
        return saved

    @staticmethod
    def _from_change(item: MailItem, change: Change, known: Loop | None) -> Loop:
        return Loop(
            source=item.app,
            ref=item.thread,
            title=change.title,
            asks=change.asks,
            direction=change.direction or "i_owe",
            people=change.people,
            due=change.due or (known.due if known else None),
            quiet_after=change.quiet_after,
            anchors=change.anchors,
        )

    @staticmethod
    def _merged(loop: Loop, change: Change) -> Loop:
        # An update changes only what the reader said; the rest of the loop stays as it was.
        return Loop(
            source=loop.source,
            ref=loop.ref,
            title=change.title or loop.title,
            asks=change.asks or loop.asks,
            direction=change.direction or loop.direction,
            people=change.people or loop.people,
            due=change.due or loop.due,
            quiet_after=change.quiet_after or loop.quiet_after,
            anchors=change.anchors or loop.anchors,
        )

    async def _close_replied(
        self, app_id: str, source: Source, since: datetime, advance: bool
    ) -> None:
        """A reply the person sent after the mail that made the loop is the loop done (no model).

        Sent mail has its own cursor, moved only after a full poll so a stop cannot skip a reply
        whose inbound mail was not read yet."""
        mark = self._store.sent_cursor(app_id)
        sent_items = await source.sent_items(datetime.fromisoformat(mark) if mark else since)
        if advance and sent_items:
            self._store.set_sent_cursor(app_id, max(s.date for s in sent_items).isoformat())
        for sent in sent_items:
            for loop in self._open(app_id):
                is_reply = loop.ref == sent.thread and loop.direction == "i_owe"
                if is_reply and sent.date > self._last_inbound(loop):
                    self._store.set_status(loop.id, "done")
                    self._store.add_history(loop.id, "you replied")  # not inbound: no mail_at

    @staticmethod
    def _last_inbound(loop: Loop) -> datetime:
        stamps = [datetime.fromisoformat(h["mail_at"]) for h in loop.history if h.get("mail_at")]
        return max(stamps) if stamps else loop.created  # type: ignore[return-value]

    def _open(self, app_id: str) -> list[Loop]:
        return [lp for s in _OPEN for lp in self._store.list(s) if lp.source == app_id]
