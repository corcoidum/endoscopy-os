from __future__ import annotations

import hashlib
import hmac
import secrets
import unicodedata
from functools import lru_cache

from pwdlib import PasswordHash

PASSWORD_HASHER = PasswordHash.recommended()
SESSION_TOKEN_BYTES = 32


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


def sha256_token(token: str, secret: str | None = None) -> str:
    payload = token.encode("utf-8")
    if secret is None:
        return hashlib.sha256(payload).hexdigest()
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def derive_csrf_token(session_token_hash: str, secret: str) -> str:
    """같은 Session을 쓰는 모든 탭이 공유하도록 Session Hash에서 CSRF Token을 파생한다.

    Session Cookie 원문 없이는 계산할 수 없고, SESSION_SECRET 없이는 Hash만으로도
    만들 수 없다.
    """

    return sha256_token(f"csrf:{session_token_hash}", secret)
