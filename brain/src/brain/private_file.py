"""Write a secret so only the current user can read it.

POSIX creates the file 0600. Windows writes it, then strips inherited access with icacls;
if that fails the file is removed, so a readable secret is never left behind.
"""

import os
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any


def write_private(
    path: Path,
    text: str,
    *,
    platform: str = sys.platform,
    run: Callable[..., Any] = subprocess.run,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if platform == "win32":
            path.write_text(text, encoding="utf-8")
            user = os.environ["USERNAME"]
            run(
                ["icacls", str(path), "/inheritance:r", "/grant:r", f"{user}:F"],
                check=True,
                capture_output=True,
            )
        else:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(text)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
