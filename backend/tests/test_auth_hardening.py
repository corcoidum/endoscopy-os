from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from starlette.requests import Request

from app.core.config import Settings
from app.core.network import resolve_client_ip
from app.core.rate_limit import LoginFailureThrottle
from app.core.security import hash_password
from app.models import User, UserSession
from tests.conftest import ADMIN_PASSWORD, TEST_ORIGIN, login_admin


def _request_from(client_ip: str, forwarded_for: str | None) -> Request:
    headers = []
    if forwarded_for is not None:
        headers.append((b"x-forwarded-for", forwarded_for.encode()))
    return Request(
        {"type": "http", "headers": headers, "client": (client_ip, 50000)}
    )


def test_legacy_random_csrf_session_is_migrated_by_me(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    login_payload = login_admin(client)
    with session_factory() as db:
        user_session = db.scalar(select(UserSession))
        assert user_session is not None
        user_session.csrf_secret_hash = "0" * 64
        db.commit()

    me_response = client.get("/api/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["csrf_token"] == login_payload["csrf_token"]

    logout_response = client.post(
        "/api/auth/logout",
        headers={
            "Origin": TEST_ORIGIN,
            "X-CSRF-Token": str(login_payload["csrf_token"]),
        },
    )
    assert logout_response.status_code == 200


def test_client_ip_uses_rightmost_untrusted_forwarded_hop() -> None:
    settings = Settings(environment="test")

    spoofed = _request_from("172.18.0.3", "10.9.9.9, 192.168.10.5")
    assert resolve_client_ip(spoofed, settings) == "192.168.10.5"

    chained = _request_from("172.18.0.3", "192.168.10.5, 172.18.0.9")
    assert resolve_client_ip(chained, settings) == "192.168.10.5"

    untrusted_direct = _request_from("192.168.10.7", "10.9.9.9")
    assert resolve_client_ip(untrusted_direct, settings) == "192.168.10.7"


def test_login_failure_throttle_expires_after_window() -> None:
    now = [0.0]
    throttle = LoginFailureThrottle(
        max_failures=2, window_seconds=60, clock=lambda: now[0]
    )

    throttle.record_failure("192.168.10.5")
    assert throttle.retry_after_seconds("192.168.10.5") is None
    throttle.record_failure("192.168.10.5")
    assert throttle.retry_after_seconds("192.168.10.5") == 60
    assert throttle.retry_after_seconds("192.168.10.6") is None

    now[0] = 60.0
    assert throttle.retry_after_seconds("192.168.10.5") is None


def test_login_is_rate_limited_per_client_before_accounts_lock(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    for index in range(10):
        response = client.post(
            "/api/auth/login",
            headers={"Origin": TEST_ORIGIN},
            json={"login_id": f"unknown{index}.test", "password": "wrong-password"},
        )
        assert response.status_code == 401

    limited = client.post(
        "/api/auth/login",
        headers={"Origin": TEST_ORIGIN},
        json={"login_id": "admin.test", "password": ADMIN_PASSWORD},
    )
    assert limited.status_code == 429
    assert limited.json()["code"] == "LOGIN_RATE_LIMITED"
    assert int(limited.headers["Retry-After"]) > 0

    with session_factory() as db:
        admin = db.scalar(
            select(User).where(User.login_id_normalized == "admin.test")
        )
        assert admin is not None
        assert admin.failed_login_count == 0
        assert admin.locked_until is None


def test_repeated_current_password_failures_lock_account_and_end_session(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    login_payload = login_admin(client)
    headers = {
        "Origin": TEST_ORIGIN,
        "X-CSRF-Token": str(login_payload["csrf_token"]),
    }
    payload = {
        "current_password": "Wrong-Current-Password-42!",
        "new_password": "Synthetic-New-Password-84!",
    }

    for _ in range(4):
        response = client.post(
            "/api/auth/change-password", headers=headers, json=payload
        )
        assert response.status_code == 400
        assert response.json()["code"] == "CURRENT_PASSWORD_INVALID"

    locked = client.post("/api/auth/change-password", headers=headers, json=payload)
    assert locked.status_code == 401
    assert locked.json()["code"] == "ACCOUNT_LOCKED"
    assert client.get("/api/auth/me").status_code == 401

    with session_factory() as db:
        admin = db.scalar(
            select(User).where(User.login_id_normalized == "admin.test")
        )
        assert admin is not None
        assert admin.locked_until is not None


def test_identity_manager_can_unlock_locked_account(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as db:
        staff = User(
            login_id_normalized="staff.test",
            password_hash=hash_password("Synthetic-Staff-Password-42!"),
            display_name="합성 직원",
            is_active=True,
            must_change_password=False,
            failed_login_count=5,
            locked_until=datetime.now(UTC) + timedelta(minutes=15),
        )
        db.add(staff)
        db.commit()
        staff_id = staff.id

    login_payload = login_admin(client)
    response = client.post(
        f"/api/users/{staff_id}/unlock",
        headers={
            "Origin": TEST_ORIGIN,
            "X-CSRF-Token": str(login_payload["csrf_token"]),
        },
    )

    assert response.status_code == 200
    assert response.json()["locked_until"] is None
    with session_factory() as db:
        unlocked = db.get(User, staff_id)
        assert unlocked is not None
        assert unlocked.failed_login_count == 0
        assert unlocked.locked_until is None
