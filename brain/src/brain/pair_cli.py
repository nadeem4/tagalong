"""What `tagalong pair` and Home's "Pair a device" show: the link as a QR code, and the address
other machines reach this one on.
"""

import io
import socket

import segno


def render_qr(link: str) -> str:
    buffer = io.StringIO()
    segno.make(link, error="m").terminal(out=buffer, compact=True)
    return buffer.getvalue()


def lan_address() -> str:
    """This machine's address on the local network. A UDP connect sends no packet; it only makes
    the OS pick the interface it would use. Loopback when there is none."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("10.255.255.255", 1))
        return probe.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        probe.close()
