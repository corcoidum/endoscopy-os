from __future__ import annotations

import hashlib
import hmac
import secrets
import unicodedata
from functools import lru_cache

from pwdlib import PasswordHash


PASSWORD_HASHER = PasswordHash.recommended()
SESSION_TOKEN_BYTES = 32
CSRF_TOKEN_BYTES = 32


def normalize_login_id(login_id: str) -> str:
    return unicodedata.normalize("NFKC", login_id).strip().casefold()


def hash_password(password: str) -> str:
    return PASSWORD_HASHER.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return PASSWORD_HASHER.verify(password, password_hash)


@lru_cache(maxsize=1)
def dummy_password_hash() -> str:
    """Unknown users still perform an Argon2id verification."""

    return PASSWORD_HASHER.hash(secrets.token_urlsafe(32))


DUMMY_PASSWORD_HASH = dummy_password_hash()


def verify_against_dummy_hash(password: str) -> None:
    PASSWORD_HASHER.verify(password, DUMMY_PASSWORD_HASH)


def generate_session_token() -> str:
    return secrets.token_urlsafe(SESSION_TOKEN_BYTES)


def generate_csrf_token() -> str:
    return secrets.token_urlsafe(CSRF_TOKEN_BYTES)


def sha256_token(token: str, secret: str | None = None) -> str:
    payload = token.encode("utf-8")
    if secret is None:
        return hashlib.sha256(payload).hexdigest()
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
