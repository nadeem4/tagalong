"""A stand-in permission engine for tests that only care what the toolbox asks it.

It records each AskRequest and answers with the decision it was built with.
"""

from brain.permission import AskRequest, Decision


class FakeEngine:
    def __init__(self, decision: Decision) -> None:
        self.decision = decision
        self.requests: list[AskRequest] = []

    async def decide(self, req: AskRequest) -> Decision:
        self.requests.append(req)
        return self.decision
