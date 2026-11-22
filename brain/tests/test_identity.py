"""The brain's self-signed identity: made once, pinned by its SHA-256 fingerprint."""

import hashlib
import re
import ssl
import sys

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import serialization

from brain.identity import load_or_create_identity, server_ssl_context


def test_creates_once_and_fingerprint_is_stable(tmp_path):
    first = load_or_create_identity(tmp_path)
    second = load_or_create_identity(tmp_path)
    assert first.fingerprint == second.fingerprint
    assert re.fullmatch(r"[0-9a-f]{64}", first.fingerprint)
    assert first.cert_path == tmp_path / "identity" / "cert.pem"


def test_fingerprint_is_sha256_of_der(tmp_path):
    ident = load_or_create_identity(tmp_path)
    cert = x509.load_pem_x509_certificate(ident.cert_path.read_bytes())
    der = cert.public_bytes(serialization.Encoding.DER)
    assert ident.fingerprint == hashlib.sha256(der).hexdigest()


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX modes")
def test_key_is_owner_only(tmp_path):
    ident = load_or_create_identity(tmp_path)
    assert ident.key_path.stat().st_mode & 0o077 == 0


def test_server_context_loads_the_pair(tmp_path):
    ctx = server_ssl_context(load_or_create_identity(tmp_path))
    assert isinstance(ctx, ssl.SSLContext)
    assert ctx.minimum_version >= ssl.TLSVersion.TLSv1_2
