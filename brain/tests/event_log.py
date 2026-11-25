"""Build a Session with its required EventLog over the same database.

Production passes the one log from main; tests only need one that shares the session's memory
and clock, so every test Session goes through here.
"""

from datetime import datetime

from brain.events import EventLog
from brain.experts import ExpertHosts
from brain.masking import Masker
from brain.node_needs import NodeNeeds
from brain.sessions import Session


def make_session(model, budget, bodies, step_cap, memory, **kw) -> Session:
    now = kw.get("now") or (lambda: datetime.now().astimezone())
    events = EventLog(memory.db, kw.get("masker") or Masker(lambda: []), now)
    kw.setdefault("make_run", ExpertHosts(needs=NodeNeeds(bodies)))
    return Session(model, budget, bodies, step_cap, memory, events=events, **kw)
