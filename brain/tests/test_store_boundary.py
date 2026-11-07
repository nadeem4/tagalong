"""Only `brain/store/` runs SQL: nothing else calls execute, executescript or executemany."""

import re
from pathlib import Path

SRC = Path(__file__).parent.parent / "src" / "brain"
SQL_CALL = re.compile(r"\.(execute|executescript|executemany)\(")


def test_no_sql_outside_store():
    offenders = [
        str(path.relative_to(SRC))
        for path in sorted(SRC.rglob("*.py"))
        if "store" not in path.relative_to(SRC).parts[:1]
        and SQL_CALL.search(path.read_text(encoding="utf-8"))
    ]
    assert offenders == []
