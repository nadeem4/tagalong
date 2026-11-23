#!/bin/sh
# Installs the Tagalong brain on a machine with no screen: uv first, then the brain as a uv tool.
# `tagalong update` upgrades it later. Review this file before piping it to a shell.
set -eu

SOURCE="git+https://github.com/nadeem4/tagalong#subdirectory=brain"

if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  PATH="$HOME/.local/bin:$PATH"
fi

uv tool install --python 3.13 --force "$SOURCE"

cat <<'MSG'

Installed. Next:
  tagalong key set                     save your Anthropic key
  tagalong serve --install-service     start the brain at logon and print a pairing QR
If `tagalong` is not found, open a new shell or run: uv tool update-shell
MSG
