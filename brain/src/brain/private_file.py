"""Write a secret so only the current user can read it.

POSIX creates the file 0600. Windows writes it, then strips inherited access with icacls;
if that fails the file is removed, so a readable secret is never left behind.
"""

import os
import subprocess
import sys
from pathlib import Path


def write_private(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if sys.platform == "win32":
            path.write_text(text, encoding="utf-8")
            user = os.environ["USERNAME"]
            subprocess.run(
                ["icacls", str(path), "/inheritance:r", "/grant:r", f"{user}:F"],
                check=True,
                capture_output=True,
            )
        else:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(text)
    except Exception:
        path.unlink(missing_ok=True)
        raise
