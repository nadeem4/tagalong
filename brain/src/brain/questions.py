"""ScoutQuestions: an expert's question goes to Scout first, who answers it or passes it on.

ask() emits a job_question wake and waits; answer() or pass_to_user() settle it. A question
that Scout never settles (wake dropped, turn ended) resolves to None, which means "ask the
owner", so the expert is never left hanging on a silent Scout.
"""

import asyncio
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from brain.events import Event
from brain.experts import Question

ANSWERED = "answered"
PASSED = "passed to the owner"


@dataclass
class _Open:
    job_id: str
    question: Question
    future: asyncio.Future


def _line(field) -> str:
    parts = [field.key, field.title, field.description]
    if field.options:
        parts.append("options " + "/".join(field.options))
    if field.multi:
        parts.append("multi")
    return " | ".join(parts)


class ScoutQuestions:
    def __init__(self, emit: Callable[..., None]) -> None:
        self._emit = emit
        self._open: dict[str, _Open] = {}

    async def ask(self, job_id: str, question: Question) -> dict | None:
        qid = uuid.uuid4().hex[:8]
        while qid in self._open:
            qid = uuid.uuid4().hex[:8]
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._open[qid] = _Open(job_id, question, future)
        facts = {
            "question": qid,
            "job": job_id,
            "message": question.message,
            "fields": "\n".join(_line(f) for f in question.fields),
        }
        # Resolving twice is harmless: on_end fires after an answer too, so settle() guards.
        settle = lambda: self._settle(qid, None)  # noqa: E731
        self._emit(Event("job_question", facts, key=None), on_drop=settle, on_end=settle)
        try:
            return await future
        finally:
            self._open.pop(qid, None)

    def answer(self, question_id: str, answers: dict) -> str:
        entry = self._open.get(question_id)
        if entry is None:
            return f"no open question {question_id}."
        missing = [f.key for f in entry.question.fields if f.key not in answers]
        if missing:
            return f"answer is missing: {', '.join(missing)}."
        content: dict = {}
        for field in entry.question.fields:
            value = answers[field.key]
            if field.multi:
                picks = value if isinstance(value, list) else [value]
                if all(p in field.options for p in picks):
                    content[field.key] = picks
                else:
                    content[f"{field.key}_custom"] = ", ".join(str(p) for p in picks)
            elif value in field.options:
                content[field.key] = value
            else:
                content[f"{field.key}_custom"] = str(value)
        self._settle(question_id, content)
        return ANSWERED

    def pass_to_user(self, question_id: str) -> str:
        if question_id not in self._open:
            return f"no open question {question_id}."
        self._settle(question_id, None)
        return PASSED

    def cancel_job(self, job_id: str) -> None:
        for qid, entry in list(self._open.items()):
            if entry.job_id == job_id:
                self._settle(qid, None)

    def _settle(self, question_id: str, content: dict | None) -> None:
        entry = self._open.get(question_id)
        if entry is not None and not entry.future.done():
            entry.future.set_result(content)
