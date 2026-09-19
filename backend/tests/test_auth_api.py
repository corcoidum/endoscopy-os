from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.models import User
from tests.conftest import ADMIN_PASSWORD, TEST_ORIGIN, login_admin


def test_login_me_keeps_csrf_stable_across_tabs_and_logout(
    client: TestClient,
) -> None:
    login_payload = login_admin(client)
    set_cookie = client.cookies.get("clinic_session_test")
    assert set_cookie
    original_csrf = login_payload["csrf_token"]
    assert login_payload["user"]["must_change_password"] is False
    assert login_payload["user"]["roles"] == ["ADMIN"]
    assert login_payload["user"]["permissions"] == [
        "appointment.create",
        "appointment.read",
        "identity.manage",
        "patient.create",
        "patient.read",
        "patient.update",
    ]

    # 새 탭이 /me를 호출해도 기존 탭이 가진 Token은 계속 유효해야 한다.
    me_response = client.get("/api/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["csrf_token"] == original_csrf

    rejected_logout = client.post(
        "/api/auth/logout",
        headers={"Origin": TEST_ORIGIN, "X-CSRF-Token": "forged-token"},
    )
    assert rejected_logout.status_code == 403

    logout_response = client.post(
        "/api/auth/logout",
        headers={"Origin": TEST_ORIGIN, "X-CSRF-Token": str(original_csrf)},
    )
    assert logout_response.status_code == 200

    assert client.get("/api/auth/me").status_code == 401


def test_repeated_login_failures_lock_the_account(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    for _ in range(5):
        response = client.post(
            "/api/auth/login",
            headers={"Origin": TEST_ORIGIN},
            json={"login_id": "admin.test", "password": "wrong-password"},
        )
        assert response.status_code == 401

    correct_password_response = client.post(
        "/api/auth/login",
        headers={"Origin": TEST_ORIGIN},
        json={"login_id": "admin.test", "password": ADMIN_PASSWORD},
    )
    assert correct_password_response.status_code == 401

    with session_factory() as db:
        user = db.scalar(
            select(User).where(User.login_id_normalized == "admin.test")
        )
        assert user is not None
        assert user.failed_login_count == 5
        assert user.locked_until is not None


def test_login_error_does_not_reveal_account_existence(client: TestClient) -> None:
    known_user = client.post(
        "/api/auth/login",
        headers={"Origin": TEST_ORIGIN},
        json={"login_id": "admin.test", "password": "wrong-password"},
    )
    unknown_user = client.post(
        "/api/auth/login",
        headers={"Origin": TEST_ORIGIN},
        json={"login_id": "unknown.test", "password": "wrong-password"},
    )

    assert known_user.status_code == unknown_user.status_code == 401
    assert known_user.json() == unknown_user.json()


def test_change_password_keeps_current_session(client: TestClient) -> None:
    login_payload = login_admin(client)
    csrf_token = login_payload["csrf_token"]
    new_password = "Synthetic-New-Password-84!"

    response = client.post(
        "/api/auth/change-password",
        headers={"Origin": TEST_ORIGIN, "X-CSRF-Token": csrf_token},
        json={
            "current_password": ADMIN_PASSWORD,
            "new_password": new_password,
        },
    )

    assert response.status_code == 200
    me_response = client.get("/api/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["user"]["must_change_password"] is False


def _require_initial_password_change(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as db:
        user = db.scalar(
            select(User).where(User.login_id_normalized == "admin.test")
        )
        assert user is not None
        user.must_change_password = True
        db.commit()


def test_required_password_change_blocks_rbac_until_changed(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    _require_initial_password_change(session_factory)
    login_payload = login_admin(client)
    assert login_payload["user"]["must_change_password"] is True

    blocked_response = client.get("/api/users")
    assert blocked_response.status_code == 403
    assert blocked_response.json()["code"] == "PASSWORD_CHANGE_REQUIRED"

    change_response = client.post(
        "/api/auth/change-password",
        headers={
            "Origin": TEST_ORIGIN,
            "X-CSRF-Token": login_payload["csrf_token"],
        },
        json={
            "current_password": ADMIN_PASSWORD,
            "new_password": "Synthetic-First-Change-Password-84!",
        },
    )
    assert change_response.status_code == 200
    assert client.get("/api/users").status_code == 200


def test_required_password_change_still_allows_me_and_logout(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    _require_initial_password_change(session_factory)
    login_admin(client)

    me_response = client.get("/api/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["user"]["must_change_password"] is True

    logout_response = client.post(
        "/api/auth/logout",
        headers={
            "Origin": TEST_ORIGIN,
            "X-CSRF-Token": me_response.json()["csrf_token"],
        },
    )
    assert logout_response.status_code == 200
