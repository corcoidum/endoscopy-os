from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session, sessionmaker

from app.models import RolePermission
from tests.conftest import TEST_ORIGIN, login_admin


def test_identity_manager_can_list_and_create_user(client: TestClient) -> None:
    login_payload = login_admin(client)
    csrf_token = login_payload["csrf_token"]

    roles_response = client.get("/api/users/roles")
    assert roles_response.status_code == 200
    role_id = roles_response.json()[0]["id"]

    create_response = client.post(
        "/api/users",
        headers={"Origin": TEST_ORIGIN, "X-CSRF-Token": csrf_token},
        json={
            "login_id": "front.synthetic",
            "password": "Synthetic-Front-Password-42!",
            "display_name": "합성 원무",
            "role_ids": [role_id],
        },
    )
    assert create_response.status_code == 201
    assert create_response.json()["login_id"] == "front.synthetic"
    assert create_response.json()["must_change_password"] is True

    list_response = client.get("/api/users")
    assert list_response.status_code == 200
    assert len(list_response.json()) == 2


def test_identity_mutation_requires_csrf(client: TestClient) -> None:
    login_admin(client)
    role_id = client.get("/api/users/roles").json()[0]["id"]

    response = client.post(
        "/api/users",
        headers={"Origin": TEST_ORIGIN},
        json={
            "login_id": "blocked.synthetic",
            "password": "Synthetic-Blocked-Password-42!",
            "display_name": "합성 차단",
            "role_ids": [role_id],
        },
    )

    assert response.status_code == 403
    assert response.json()["code"] == "CSRF_TOKEN_INVALID"


def test_backend_rbac_denies_permission_removed_after_login(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    login_admin(client)
    with session_factory() as db:
        db.execute(delete(RolePermission))
        db.commit()

    response = client.get("/api/users")

    assert response.status_code == 403
    assert response.json()["code"] == "PERMISSION_DENIED"
