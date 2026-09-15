from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import make_url

from app.core.config import Settings
from app.core.security import (
    derive_csrf_token,
    generate_session_token,
    hash_password,
    normalize_login_id,
    sha256_token,
    verify_password,
)
from app.models import User, UserSession
from app.services.auth import session_invalid_reason


def test_login_id_is_nfkc_normalized_and_casefolded() -> None:
    assert normalize_login_id("  Ａdmin.Test  ") == "admin.test"


def test_password_uses_one_way_argon2id_hash() -> None:
    password = "Synthetic-Password-42!"
    encoded = hash_password(password)

    assert password not in encoded
    assert encoded.startswith("$argon2id$")
    assert verify_password(password, encoded)
    assert not verify_password("wrong-password", encoded)


def test_session_and_csrf_tokens_have_independent_hashes() -> None:
    secret = "synthetic-session-secret-at-least-32-bytes"
    session_token = generate_session_token()
    session_hash = sha256_token(session_token, secret)
    csrf_token = derive_csrf_token(session_hash, secret)

    assert session_token != csrf_token
    assert csrf_token == derive_csrf_token(session_hash, secret)
    assert csrf_token != derive_csrf_token(session_hash, secret + "-other")
    assert len(sha256_token(session_token)) == 64
    assert sha256_token(session_token) != sha256_token(csrf_token)


def test_idle_expiry_is_rejected_before_absolute_expiry() -> None:
    now = datetime.now(UTC)
    user = User(
        login_id_normalized="synthetic.user",
        password_hash="not-used",
        display_name="합성 사용자",
        is_active=True,
    )
    user_session = UserSession(
        user=user,
        session_token_hash="a" * 64,
        csrf_secret_hash="b" * 64,
        created_ip="192.168.0.10",
        created_at=now - timedelta(hours=1),
        last_seen_at=now - timedelta(minutes=31),
        idle_expires_at=now - timedelta(seconds=1),
        absolute_expires_at=now + timedelta(hours=1),
    )

    reason = session_invalid_reason(
        user_session,
        now=now,
        client_ip="192.168.0.10",
        bind_to_ip=True,
    )

    assert reason == "미사용 시간이 지나 Session이 만료되었습니다."


def test_production_rejects_insecure_cookie() -> None:
    with pytest.raises(ValueError, match="Secure"):
        Settings(
            environment="production",
            session_secret="production-session-secret-at-least-32-bytes",
            postgres_password="production-db-password-at-least-16",
            session_cookie_secure=False,
        )


def test_production_requires_persistent_session_secret() -> None:
    with pytest.raises(ValueError, match="SESSION_SECRET"):
        Settings(environment="production")


def test_session_secret_rejects_placeholder() -> None:
    with pytest.raises(ValueError, match="Placeholder"):
        Settings(
            environment="test",
            session_secret="change-me-example-secret-at-least-32-bytes",
        )


def test_production_rejects_generate_placeholders() -> None:
    with pytest.raises(ValueError, match="SESSION_SECRET"):
        Settings(
            environment="production",
            session_secret="__GENERATE_UNIQUE_SESSION_SECRET__",
            postgres_password="production-db-password-at-least-16",
        )

    with pytest.raises(ValueError, match="Database Password"):
        Settings(
            environment="production",
            session_secret="production-session-secret-at-least-32-bytes",
            postgres_password="__GENERATE_UNIQUE_DB_PASSWORD__",
        )


def test_production_requires_database_password() -> None:
    with pytest.raises(ValueError, match="Database 연결"):
        Settings(
            environment="production",
            session_secret="production-session-secret-at-least-32-bytes",
        )


def test_production_validates_effective_database_url_password() -> None:
    with pytest.raises(ValueError, match="Database Password"):
        Settings(
            environment="production",
            database_url=(
                "postgresql+psycopg://clinic:short@db/clinic_endoscopy"
            ),
            postgres_password="strong-but-unused-password-42",
            session_secret="production-session-secret-at-least-32-bytes",
        )


def test_production_requires_field_encryption_key() -> None:
    with pytest.raises(ValueError, match="FIELD_ENCRYPTION_KEY"):
        Settings(
            environment="production",
            session_secret="production-session-secret-at-least-32-bytes",
            postgres_password="production-db-password-at-least-16",
        )


def test_field_encryption_key_rejects_placeholder() -> None:
    with pytest.raises(ValueError, match="FIELD_ENCRYPTION_KEY"):
        Settings(
            environment="test",
            field_encryption_key="__GENERATE_UNIQUE_FIELD_ENCRYPTION_KEY__",
        )


def test_database_url_safely_encodes_split_credentials() -> None:
    settings = Settings(
        environment="test",
        postgres_user="clinic user",
        postgres_password="p@ss:/word",
        database_host="db",
        postgres_db="clinic",
    )

    assert settings.database_url is not None
    parsed_url = make_url(settings.database_url)
    assert parsed_url.username == "clinic user"
    assert parsed_url.password == "p@ss:/word"
