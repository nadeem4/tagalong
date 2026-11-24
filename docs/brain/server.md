# The brain as a server

How to run the brain on a machine with no screen: a home server, a spare PC or a container. Other devices (a desktop, a node) pair with it over the encrypted network listener; see [safety.md](safety.md#pairing-a-device) for how pairing and device tokens work.

- [`tagalong serve`](#tagalong-serve)
- [The install script](#the-install-script)
- [Docker](#docker)
- [Updating](#updating)
- [The address in the pairing link](#the-address-in-the-pairing-link)

## `tagalong serve`

`tagalong serve` saves `TAGALONG_NETWORK=1` in `<TAGALONG_HOME>/.env`, prints a pairing QR and link, then runs the brain in the foreground (`brain.main.main`, the same as `uv run brain`). The link is a `desktop` pairing code, valid 10 minutes and once, made by the same code as `tagalong pair`. It is printed only while no device is paired; after that a start prints `Pair another device with tagalong pair`, and a paired brain never shows a fresh code on its own.

The desktop's **Let other devices connect** (pair dialog or the brain card switch) ends the brain Tagalong started, runs `tagalong service install` and waits for the brain to drop and return, because a running brain only listens for other devices after a restart. There is no command to turn network access off again.

`tagalong serve --install-service` does not run the brain. It installs the logon service exactly as `tagalong service install` does (the unit, the `.env` switch, the rollback if the OS refuses) and then prints the pairing QR. The service starts the brain, so the code can be redeemed as soon as it is up; run `tagalong pair` for a fresh code if the 10 minutes pass.

The brain's loopback listener (`127.0.0.1:47321`) stays loopback-only. The network listener is on `47323` (not `47322`, which the WhatsApp bridge uses).

## The install script

`install/install.sh` (Linux and macOS) and `install/install.ps1` (Windows) install [uv](https://docs.astral.sh/uv/) (pinned to 0.12.17) when it is missing, then install the brain as a uv tool from this repository's `main` branch (`uv tool install --python 3.13 --force git+https://github.com/nadeem4/tagalong#subdirectory=brain`), which puts `tagalong` and `brain` on the path. They print what to run next: `tagalong key set`, then `tagalong serve --install-service`. They change nothing else and start nothing. Read a script before piping it to a shell.

```sh
curl -LsSf https://raw.githubusercontent.com/nadeem4/tagalong/main/install/install.sh | sh
```

```powershell
irm https://raw.githubusercontent.com/nadeem4/tagalong/main/install/install.ps1 | iex
```

`shellcheck install/install.sh` is clean.

## Docker

The `Dockerfile` at the repository root builds the brain on `ghcr.io/astral-sh/uv:python3.13-bookworm-slim` from `brain/pyproject.toml`, `brain/uv.lock` and `brain/src` only (`.dockerignore` excludes everything else). It runs as a non-root user, keeps all data in the `/data` volume (`TAGALONG_HOME`; use a named volume, because a bind-mounted host folder is root-owned and the non-root `tagalong` user cannot write it) and starts `tagalong serve`. It bakes in no key, token or `.env`: the Anthropic key arrives as `-e ANTHROPIC_API_KEY=...` or in `/data/.env`.

```sh
docker build -t tagalong .
docker run -v tagalong:/data -p 47323:47323 -e TAGALONG_PUBLIC_HOST=my-server.example.net tagalong
```

The image exposes `47323` only. The loopback port `47321` is inside the container and is never published, so only a device holding a token can reach the brain. The first start prints the pairing QR to the container log (`docker logs`); `docker exec <container> tagalong pair` makes another.

CI builds the image on every code change (the `image` job in `.github/workflows/ci.yml`, cached, never pushed) and checks that only `47323` is exposed and that the first start prints a pairing link. Nothing builds or runs the image locally.

## Updating

`tagalong update` runs `uv tool upgrade brain`, which pulls the newest source the install script used. It prints what uv said when it fails. A running brain keeps the old version until `tagalong stop` and a restart (a service restarts itself at the next logon, or run `tagalong service install` again). A container is updated by pulling or rebuilding the image; the `/data` volume keeps everything.

## The address in the pairing link

The link names the machine by its LAN address. Behind Docker's network that is the container's address, which no other device can reach, so set `TAGALONG_PUBLIC_HOST` to the name or address devices should dial (the port is added). It is read once, into `Config.public_host`, and used by `tagalong serve`, `tagalong pair` and the pairing codes the running brain makes.
