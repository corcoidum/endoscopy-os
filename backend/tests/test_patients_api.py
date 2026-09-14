from __future__ import annotations

from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.security import hash_password
from app.models import (
    Patient,
    PatientHistoryEvent,
    Permission,
    Role,
    RolePermission,
    User,
    UserRole,
)
from tests.conftest import TEST_ORIGIN, login_admin


SYNTHETIC_PATIENT = {
    "chart_number": "SYN-0012",
    "name": "합성해솔",
    "birth_date": "1984-07-31",
    "sex": "FEMALE",
    "phone": "000-0000-0000",
    "special_notes": "합성 데이터 메모",
}


def _create_patient(client: TestClient) -> tuple[dict[str, object], str]:
    login_payload = login_admin(client)
    csrf_token = str(login_payload["csrf_token"])
    response = client.post(
        "/api/patients",
        headers={"Origin": TEST_ORIGIN, "X-CSRF-Token": csrf_token},
        json=SYNTHETIC_PATIENT,
    )
    assert response.status_code == 201, response.text
    return response.json()["patient"], csrf_token


def test_patient_create_search_detail_and_history(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    patient, _ = _create_patient(client)
    patient_id = patient["id"]

    assert patient["chart_number"] == "SYN-0012"
    assert patient["sex"] == "FEMALE"
    assert patient["phone"] == "000-0000-0000"
    assert patient["special_notes"] == "합성 데이터 메모"

    search_response = client.get(
        "/api/patients",
        params={"query": "해솔", "reference_date": "2026-07-31"},
    )
    assert search_response.status_code == 200
    search_payload = search_response.json()
    assert search_payload["total"] == 1
    assert search_payload["items"][0]["id"] == patient_id
    assert search_payload["items"][0]["age"] == 42
    assert "phone" not in search_payload["items"][0]
    assert "special_notes" not in search_payload["items"][0]

    detail_response = client.get(f"/api/patients/{patient_id}")
    assert detail_response.status_code == 200
    assert detail_response.json()["phone"] == "000-0000-0000"

    history_response = client.get(f"/api/patients/{patient_id}/history")
    assert history_response.status_code == 200
    history = history_response.json()
    assert len(history) == 1
    assert history[0]["event_type"] == "CREATED"
    assert history[0]["actor_display_name"] == "합성 관리자"
    assert "000-0000-0000" not in str(history[0])
    assert "합성 데이터 메모" not in str(history[0])

    with session_factory() as db:
        stored = db.scalar(
            select(Patient).where(Patient.id == UUID(patient_id))
        )
        assert stored is not None
        assert stored.phone_ciphertext is not None
        assert stored.special_notes_ciphertext is not None


def test_duplicate_chart_number_is_blocked(client: TestClient) -> None:
    _, csrf_token = _create_patient(client)

    response = client.post(
        "/api/patients",
        headers={"Origin": TEST_ORIGIN, "X-CSRF-Token": csrf_token},
        json={**SYNTHETIC_PATIENT, "name": "합성다른이름"},
    )

    assert response.status_code == 409
    assert response.json()["code"] == "CHART_NUMBER_DUPLICATE"


def test_same_demographics_warn_but_do_not_block(client: TestClient) -> None:
    _, csrf_token = _create_patient(client)

    response = client.post(
        "/api/patients",
        headers={"Origin": TEST_ORIGIN, "X-CSRF-Token": csrf_token},
        json={**SYNTHETIC_PATIENT, "chart_number": "SYN-0099"},
    )

    assert response.status_code == 201
    warning = response.json()["warnings"][0]
    assert warning["code"] == "DEMOGRAPHIC_DUPLICATE_CANDIDATE"
    assert len(warning["candidates"]) == 1


def test_patient_update_requires_reason_and_preserves_history(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    patient, csrf_token = _create_patient(client)
    patient_id = patient["id"]

    response = client.patch(
        f"/api/patients/{patient_id}",
        headers={"Origin": TEST_ORIGIN, "X-CSRF-Token": csrf_token},
        json={
            "row_version": patient["row_version"],
            "reason": "접수 중 이름 재확인",
            "name": "합성해솔정정",
            "phone": None,
        },
    )

    assert response.status_code == 200, response.text
    updated = response.json()["patient"]
    assert updated["name"] == "합성해솔정정"
    assert updated["phone"] is None
    assert updated["row_version"] == 2

    stale_response = client.patch(
        f"/api/patients/{patient_id}",
        headers={"Origin": TEST_ORIGIN, "X-CSRF-Token": csrf_token},
        json={
            "row_version": 1,
            "reason": "오래된 화면에서 변경",
            "name": "합성충돌",
        },
    )
    assert stale_response.status_code == 409
    assert stale_response.json()["code"] == "PATIENT_STALE_DATA"

    with session_factory() as db:
        events = list(
            db.scalars(
                select(PatientHistoryEvent)
                .where(
                    PatientHistoryEvent.patient_id == UUID(patient_id)
                )
                .order_by(PatientHistoryEvent.occurred_at)
            ).all()
        )
        assert [event.event_type for event in events] == [
            "CREATED",
            "UPDATED",
        ]
        assert events[1].reason == "접수 중 이름 재확인"
        assert "phone" in events[1].changed_fields


def test_patient_is_deactivated_without_physical_delete(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    patient, csrf_token = _create_patient(client)
    patient_id = patient["id"]

    response = client.patch(
        f"/api/patients/{patient_id}/activation",
        headers={"Origin": TEST_ORIGIN, "X-CSRF-Token": csrf_token},
        json={
            "row_version": patient["row_version"],
            "is_active": False,
            "reason": "합성 중복환자 비활성화",
        },
    )

    assert response.status_code == 200
    assert response.json()["patient"]["is_active"] is False
    assert client.get("/api/patients").json()["total"] == 0
    assert (
        client.get(
            "/api/patients", params={"include_inactive": True}
        ).json()["total"]
        == 1
    )
    with session_factory() as db:
        assert db.get(Patient, UUID(patient_id)) is not None


def test_patient_mutation_requires_csrf(client: TestClient) -> None:
    login_admin(client)

    response = client.post(
        "/api/patients",
        headers={"Origin": TEST_ORIGIN},
        json=SYNTHETIC_PATIENT,
    )

    assert response.status_code == 403
    assert response.json()["code"] == "CSRF_TOKEN_INVALID"


def test_patient_rbac_is_checked_again_on_each_request(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    login_admin(client)
    with session_factory() as db:
        db.execute(delete(RolePermission))
        db.commit()

    response = client.get("/api/patients")

    assert response.status_code == 403
    assert response.json()["code"] == "PERMISSION_DENIED"


def test_read_only_user_can_search_but_cannot_create(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as db:
        permission = db.scalar(
            select(Permission).where(Permission.code == "patient.read")
        )
        assert permission is not None
        role = Role(code="READ_ONLY_TEST", name_ko="조회 전용", is_active=True)
        role.permission_assignments = [
            RolePermission(permission=permission)
        ]
        user = User(
            login_id_normalized="readonly.patient",
            password_hash=hash_password("Synthetic-Readonly-Password-42!"),
            display_name="합성 조회자",
            is_active=True,
            must_change_password=False,
        )
        user.role_assignments = [UserRole(role=role)]
        db.add(user)
        db.commit()

    login_response = client.post(
        "/api/auth/login",
        headers={"Origin": TEST_ORIGIN},
        json={
            "login_id": "readonly.patient",
            "password": "Synthetic-Readonly-Password-42!",
        },
    )
    assert login_response.status_code == 200
    csrf_token = login_response.json()["csrf_token"]
    assert client.get("/api/patients").status_code == 200

    create_response = client.post(
        "/api/patients",
        headers={"Origin": TEST_ORIGIN, "X-CSRF-Token": csrf_token},
        json=SYNTHETIC_PATIENT,
    )

    assert create_response.status_code == 403
    assert create_response.json()["code"] == "PERMISSION_DENIED"
