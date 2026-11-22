"""The brain's self-signed identity. Bodies pin its SHA-256 fingerprint instead of checking
names, so the certificate carries no SAN and lasts ten years.
"""

import hashlib
import ssl
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from brain.private_file import write_private


@dataclass(frozen=True)
class Identity:
    cert_path: Path
    key_path: Path
    fingerprint: str  # SHA-256 of the DER certificate, lowercase hex


def _fingerprint(cert_pem: bytes) -> str:
    cert = x509.load_pem_x509_certificate(cert_pem)
    return hashlib.sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest()


def load_or_create_identity(data_dir: Path) -> Identity:
    cert_path = data_dir / "identity" / "cert.pem"
    key_path = data_dir / "identity" / "key.pem"
    if not (cert_path.exists() and key_path.exists()):
        key = ec.generate_private_key(ec.SECP256R1())
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "tagalong-brain")])
        now = datetime.now(UTC)
        cert = (
            x509.CertificateBuilder()
            .subject_name(name)
            .issuer_name(name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(days=1))
            .not_valid_after(now + timedelta(days=3650))
            .sign(key, hashes.SHA256())
        )
        key_pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        write_private(key_path, key_pem.decode())
        cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return Identity(cert_path, key_path, _fingerprint(cert_path.read_bytes()))


def server_ssl_context(identity: Identity) -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(identity.cert_path, identity.key_path)
    return ctx
