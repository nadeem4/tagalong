# The Tagalong brain as a server: network listener on 47323, data in the /data volume.
# The loopback port (47321) stays inside the container and is never published.
# Build from the repository root: docker build -t tagalong .
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    TAGALONG_HOME=/data \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app
COPY brain/pyproject.toml brain/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY brain/src ./src
RUN uv sync --locked --no-dev

RUN useradd --create-home tagalong && mkdir /data && chown tagalong /data
USER tagalong
VOLUME /data
EXPOSE 47323

ENTRYPOINT []
CMD ["tagalong", "serve"]
