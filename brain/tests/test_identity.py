"""The brain's self-signed identity: made once, pinned by its SHA-256 fingerprint."""

import hashlib
import re

from cryptography import x509
from cryptography.hazmat.primitives import serialization

from brain.identity import load_or_create_identity


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
