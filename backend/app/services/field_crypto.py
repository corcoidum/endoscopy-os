"""검색하지 않는 민감 자유서술 필드의 암호화.

PostgreSQL에서는 `pgcrypto`의 `pgp_sym_encrypt`(AES-256)로 저장하고 조회할 때만
복호화한다. SQLite Test Database는 합성 데이터만 쓰므로 UTF-8 bytes로 두어 운영
암호화 경로와 분리한다.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import String, func
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.core.config import Settings

CIPHER_OPTIONS = "cipher-algo=aes256,compress-algo=0"


def uses_test_ciphertext(db: Session) -> bool:
    return db.get_bind().dialect.name == "sqlite"


def encrypt_text(db: Session, value: str | None, settings: Settings) -> Any:
    """저장할 암호문 값 또는 SQL 식을 돌려준다. `None`은 그대로 둔다."""

    if value is None:
        return None
    if uses_test_ciphertext(db):
        return value.encode("utf-8")
    return func.pgp_sym_encrypt(value, settings.field_encryption_key_value, CIPHER_OPTIONS)


def decrypted(column: Any, settings: Settings) -> ColumnElement[str]:
    """SELECT 목록에 넣을 복호화 식. PostgreSQL 경로에서만 쓴다."""

    return func.pgp_sym_decrypt(column, settings.field_encryption_key_value).cast(String)


def decode_test_ciphertext(value: bytes | None) -> str | None:
    return value.decode("utf-8") if value is not None else None
