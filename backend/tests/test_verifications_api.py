"""Sprint 4A 인적사항 1·2차 확인·정정·자동 무효화 API Test(합성 계정·환자만 사용)."""

from __future__ import annotations

from collections.abc import Generator
from dataclasses import dataclass
from datetime import time
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.cli.seed_identity import ROLE_DEFINITIONS
from app.core.config import Settings
from app.core.security import hash_password
from app.db.session import get_db
from app.main import create_app
from app.models import (
    PatientVerification,
    Permission,
    Role,
    RolePermission,
    User,
    UserRole,
)
from app.services.appointments import change_appointment
from tests.conftest import (
    ADMIN_PASSWORD,
    BOOKING_DAY,
    TEST_ORIGIN,
    SeededIdentity,
    iso,
)

ENDO_LOGIN = "endo.test"
VIEWER_LOGIN = "viewer.test"
STAFF_PASSWORD = "Synthetic-Staff-Password-42!"
UPPER = [{"procedure_code": "UPPER", "sedation_mode": "SEDATED"}]


@dataclass
class Staff:
    admin: TestClient
    admin_csrf: str
    endo: TestClient
    endo_csrf: str
    viewer: TestClient
    viewer_csrf: str
    admin_id: UUID
    endo_id: UUID


def _permission(db: Session, code: str) -> Permission:
    permission = db.scalar(select(Permission).where(Permission.code == code))
    if permission is None:
        permission = Permission(code=code, description_ko=code)
        db.add(permission)
        db.flush()
    return permission


def _grant(db: Session, role: Role, codes: list[str]) -> None:
    assigned = {assignment.permission.code for assignment in role.permission_assignments}
    for code in codes:
        if code not in assigned:
            role.permission_assignments.append(RolePermission(permission=_permission(db, code)))


def _user(db: Session, login_id: str, name: str, role: Role) -> User:
    user = User(
        login_id_normalized=login_id,
        password_hash=hash_password(STAFF_PASSWORD),
        display_name=name,
        is_active=True,
        must_change_password=False,
    )
    user.role_assignments = [UserRole(role=role)]
    db.add(user)
    return user


@pytest.fixture
def app(
    session_factory: sessionmaker[Session],
    seeded_identity: SeededIdentity,
    test_settings: Settings,
) -> FastAPI:
    application = create_app(test_settings)

    def override_get_db() -> Generator[Session]:
        with session_factory() as db:
            try:
                yield db
            except Exception:
                db.rollback()
                raise

    application.dependency_overrides[get_db] = override_get_db
    return application


def _login(app: FastAPI, login_id: str, password: str) -> tuple[TestClient, str]:
    client = TestClient(app, base_url="https://testserver")
    response = client.post(
        "/api/auth/login",
        headers={"Origin": TEST_ORIGIN},
        json={"login_id": login_id, "password": password},
    )
    assert response.status_code == 200, response.text
    return client, str(response.json()["csrf_token"])


@pytest.fixture
def staff(
    app: FastAPI,
    session_factory: sessionmaker[Session],
    seeded_identity: SeededIdentity,
) -> Staff:
    """관리자(1·2차 모두), 내시경 담당(2차만), 조회 전용 사용자를 만든다."""

    with session_factory() as db:
        admin_role = db.get(Role, seeded_identity.role_id)
        assert admin_role is not None
        _grant(
            db,
            admin_role,
            [
                "appointment.update",
                "appointment.cancel",
                "appointment.no_show",
                "verification.primary",
                "verification.secondary",
            ],
        )
        endo_role = Role(code="ENDOSCOPY_STAFF", name_ko="내시경 담당자", is_active=True)
        viewer_role = Role(code="READ_ONLY", name_ko="조회 전용", is_active=True)
        db.add_all([endo_role, viewer_role])
        db.flush()
        _grant(db, endo_role, ["appointment.read", "patient.read", "verification.secondary"])
        _grant(db, viewer_role, ["appointment.read", "patient.read"])
        endo = _user(db, ENDO_LOGIN, "합성 내시경 담당", endo_role)
        _user(db, VIEWER_LOGIN, "합성 조회 담당", viewer_role)
        db.commit()
        endo_id = endo.id
    admin, admin_csrf = _login(app, "admin.test", ADMIN_PASSWORD)
    endo_client, endo_csrf = _login(app, ENDO_LOGIN, STAFF_PASSWORD)
    viewer, viewer_csrf = _login(app, VIEWER_LOGIN, STAFF_PASSWORD)
    return Staff(
        admin=admin,
        admin_csrf=admin_csrf,
        endo=endo_client,
        endo_csrf=endo_csrf,
        viewer=viewer,
        viewer_csrf=viewer_csrf,
        admin_id=seeded_identity.user_id,
        endo_id=endo_id,
    )


def _headers(csrf_token: str) -> dict[str, str]:
    return {"Origin": TEST_ORIGIN, "X-CSRF-Token": csrf_token}


def _patient(staff: Staff, chart_number: str = "SYN-VER-001") -> dict[str, object]:
    response = staff.admin.post(
        "/api/patients",
        headers=_headers(staff.admin_csrf),
        json={
            "chart_number": chart_number,
            "name": "합성확인환자",
            "birth_date": "1980-12-31",
            "sex": "FEMALE",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["patient"]


def _book(
    staff: Staff,
    patient_id: str,
    *,
    start_time: str = "09:00",
    care_type: str = "GENERAL",
) -> dict[str, object]:
    response = staff.admin.post(
        "/api/appointments",
        headers=_headers(staff.admin_csrf),
        json={
            "patient_id": patient_id,
            "service_date": iso(BOOKING_DAY),
            "start_time": start_time,
            "care_type": care_type,
            "procedures": UPPER,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _status(client: TestClient, appointment_id: object) -> dict[str, object]:
    response = client.get(f"/api/appointments/{appointment_id}/verifications")
    assert response.status_code == 200, response.text
    return response.json()


def _verify(
    client: TestClient,
    csrf_token: str,
    appointment_id: object,
    stage: str,
    fingerprint: object,
    **extra: object,
):
    return client.post(
        f"/api/appointments/{appointment_id}/verifications/{stage}",
        headers=_headers(csrf_token),
        json={"expected_fingerprint": fingerprint, "method": "IN_PERSON", **extra},
    )


def _verified(staff: Staff) -> tuple[dict[str, object], dict[str, object]]:
    """관리자 1차 → 내시경 담당 2차까지 끝낸 예약을 만든다."""

    patient = _patient(staff)
    appointment = _book(staff, str(patient["id"]))
    fingerprint = _status(staff.admin, appointment["id"])["fingerprint"]
    primary = _verify(staff.admin, staff.admin_csrf, appointment["id"], "primary", fingerprint)
    assert primary.status_code == 201, primary.text
    secondary = _verify(staff.endo, staff.endo_csrf, appointment["id"], "secondary", fingerprint)
    assert secondary.status_code == 201, secondary.text
    assert secondary.json()["state"] == "VERIFIED"
    return patient, appointment


def _valid_count(session_factory: sessionmaker[Session], appointment_id: object) -> int:
    with session_factory() as db:
        return len(
            db.scalars(
                select(PatientVerification).where(
                    PatientVerification.appointment_id == UUID(str(appointment_id)),
                    PatientVerification.is_valid.is_(True),
                )
            ).all()
        )


def test_two_different_users_complete_double_verification(staff: Staff) -> None:
    patient = _patient(staff)
    appointment = _book(staff, str(patient["id"]))
    assert appointment["verification_state"] == "UNVERIFIED"
    status = _status(staff.admin, appointment["id"])
    assert status["state"] == "UNVERIFIED"
    # 비검진 예약은 검사일 기준 만 나이를 확인한다.
    assert status["current"]["age_method"] == "FULL_AGE"
    assert status["current"]["age_reference_date"] == iso(BOOKING_DAY)

    primary = _verify(
        staff.admin,
        staff.admin_csrf,
        appointment["id"],
        "primary",
        status["fingerprint"],
        method="ID_DOCUMENT",
        memo="신분증 대조",
    )
    assert primary.status_code == 201, primary.text
    assert primary.json()["state"] == "PRIMARY_DONE"
    record = primary.json()["primary"]
    assert record["verified_by_name"] == "합성 관리자"
    assert record["method"] == "ID_DOCUMENT"
    assert record["memo"] == "신분증 대조"
    assert record["subject"]["name"] == "합성확인환자"
    assert record["subject"]["computed_age"] == status["current"]["computed_age"]

    secondary = _verify(
        staff.endo, staff.endo_csrf, appointment["id"], "secondary", status["fingerprint"]
    )
    assert secondary.status_code == 201, secondary.text
    body = secondary.json()
    assert body["state"] == "VERIFIED"
    assert body["secondary"]["verified_by_name"] == "합성 내시경 담당"

    listing = staff.admin.get(
        "/api/appointments",
        params={"start_date": iso(BOOKING_DAY), "end_date": iso(BOOKING_DAY)},
    )
    assert listing.json()["items"][0]["verification_state"] == "VERIFIED"


def test_same_user_cannot_complete_both_stages_even_as_admin(
    staff: Staff, session_factory: sessionmaker[Session]
) -> None:
    patient = _patient(staff)
    appointment = _book(staff, str(patient["id"]))
    fingerprint = _status(staff.admin, appointment["id"])["fingerprint"]
    assert _verify(staff.admin, staff.admin_csrf, appointment["id"], "primary", fingerprint).status_code == 201

    # 관리자는 두 권한을 모두 갖지만 같은 계정으로 2차 확인할 수 없다.
    same = _verify(staff.admin, staff.admin_csrf, appointment["id"], "secondary", fingerprint)
    assert same.status_code == 409
    assert same.json()["code"] == "SECOND_REVIEWER_INVALID"
    assert _status(staff.admin, appointment["id"])["state"] == "PRIMARY_DONE"
    assert _valid_count(session_factory, appointment["id"]) == 1


def test_permissions_and_csrf_are_enforced(
    staff: Staff, session_factory: sessionmaker[Session]
) -> None:
    patient = _patient(staff)
    appointment = _book(staff, str(patient["id"]))
    fingerprint = _status(staff.viewer, appointment["id"])["fingerprint"]

    for client, csrf, stage in (
        (staff.viewer, staff.viewer_csrf, "primary"),
        (staff.viewer, staff.viewer_csrf, "secondary"),
        # 내시경 담당은 2차 권한만 있다.
        (staff.endo, staff.endo_csrf, "primary"),
    ):
        denied = _verify(client, csrf, appointment["id"], stage, fingerprint)
        assert denied.status_code == 403, denied.text
        assert denied.json()["code"] == "PERMISSION_DENIED"

    missing_csrf = staff.admin.post(
        f"/api/appointments/{appointment['id']}/verifications/primary",
        headers={"Origin": TEST_ORIGIN},
        json={"expected_fingerprint": fingerprint, "method": "IN_PERSON"},
    )
    assert missing_csrf.status_code == 403
    assert missing_csrf.json()["code"] == "CSRF_TOKEN_INVALID"
    assert _valid_count(session_factory, appointment["id"]) == 0


def test_secondary_requires_a_valid_primary(staff: Staff) -> None:
    patient = _patient(staff)
    appointment = _book(staff, str(patient["id"]))
    fingerprint = _status(staff.endo, appointment["id"])["fingerprint"]
    response = _verify(staff.endo, staff.endo_csrf, appointment["id"], "secondary", fingerprint)
    assert response.status_code == 409
    assert response.json()["code"] == "PRIMARY_VERIFICATION_REQUIRED"


def test_duplicate_and_stale_requests_do_not_create_extra_valid_records(
    staff: Staff, session_factory: sessionmaker[Session]
) -> None:
    patient = _patient(staff)
    appointment = _book(staff, str(patient["id"]))
    fingerprint = _status(staff.admin, appointment["id"])["fingerprint"]
    assert _verify(staff.admin, staff.admin_csrf, appointment["id"], "primary", fingerprint).status_code == 201

    duplicate = _verify(staff.admin, staff.admin_csrf, appointment["id"], "primary", fingerprint)
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "VERIFICATION_ALREADY_DONE"

    # 화면을 연 뒤 정보가 바뀐 상황: 화면이 들고 있던 지문이 현재 값과 다르다.
    stale = _verify(staff.endo, staff.endo_csrf, appointment["id"], "secondary", "0" * 64)
    assert stale.status_code == 409
    assert stale.json()["code"] == "VERIFICATION_STALE"
    assert _valid_count(session_factory, appointment["id"]) == 1


def test_correction_requires_reason_keeps_primary_and_allows_reverification(
    staff: Staff,
) -> None:
    _, appointment = _verified(staff)
    before = _status(staff.endo, appointment["id"])
    secondary_id = before["secondary"]["id"]
    correct_url = f"/api/appointments/{appointment['id']}/verifications/secondary/correct"

    for reason in ("", "   "):
        rejected = staff.endo.post(
            correct_url,
            headers=_headers(staff.endo_csrf),
            json={"verification_id": secondary_id, "reason": reason},
        )
        assert rejected.status_code == 422, rejected.text
    assert _status(staff.endo, appointment["id"])["state"] == "VERIFIED"

    corrected = staff.endo.post(
        correct_url,
        headers=_headers(staff.endo_csrf),
        json={"verification_id": secondary_id, "reason": "다른 환자 화면에서 확인함"},
    )
    assert corrected.status_code == 200, corrected.text
    body = corrected.json()
    assert body["state"] == "PRIMARY_DONE"
    # 유효한 1차 확인은 그대로 남는다.
    assert body["primary"]["id"] == before["primary"]["id"]
    original = next(record for record in body["history"] if record["id"] == secondary_id)
    assert original["is_valid"] is False
    assert original["invalidation_type"] == "CORRECTED"
    assert original["invalidation_reason"] == "다른 환자 화면에서 확인함"
    assert original["invalidated_by_name"] == "합성 내시경 담당"
    assert original["invalidated_at"] is not None
    assert body["last_invalidation"]["id"] == secondary_id

    # 이미 정정한 확인을 오래된 화면에서 다시 정정하면 거절한다.
    again = staff.endo.post(
        correct_url,
        headers=_headers(staff.endo_csrf),
        json={"verification_id": secondary_id, "reason": "중복 정정"},
    )
    assert again.status_code == 409
    assert again.json()["code"] == "VERIFICATION_STALE"

    rechecked = _verify(
        staff.endo, staff.endo_csrf, appointment["id"], "secondary", body["fingerprint"]
    )
    assert rechecked.status_code == 201, rechecked.text
    assert rechecked.json()["state"] == "VERIFIED"
    assert len(rechecked.json()["history"]) == 3


def test_core_appointment_change_invalidates_and_keeps_past_snapshot(staff: Staff) -> None:
    _, appointment = _verified(staff)
    changed = staff.admin.patch(
        f"/api/appointments/{appointment['id']}",
        headers=_headers(staff.admin_csrf),
        json={"row_version": appointment["row_version"], "reason": "환자 요청", "start_time": "10:00"},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["verification_state"] == "REVERIFY_REQUIRED"

    status = _status(staff.admin, appointment["id"])
    assert status["state"] == "REVERIFY_REQUIRED"
    assert status["primary"] is None and status["secondary"] is None
    for record in status["history"]:
        assert record["is_valid"] is False
        assert record["invalidation_type"] == "CORE_CHANGED"
        assert "시작시각" in record["invalidation_reason"]
        assert "환자 요청" in record["invalidation_reason"]
        # 과거 Snapshot은 변경 전 값을 그대로 보존한다.
        assert record["subject"]["start_time"] == "09:00"
    assert status["current"]["start_time"] == "10:00"

    reverified = _verify(
        staff.admin, staff.admin_csrf, appointment["id"], "primary", status["fingerprint"]
    )
    assert reverified.status_code == 201, reverified.text
    assert reverified.json()["state"] == "PRIMARY_DONE"
    assert len(reverified.json()["history"]) == 3


def test_patient_core_change_invalidates_but_contact_change_keeps(staff: Staff) -> None:
    patient, appointment = _verified(staff)
    patient_url = f"/api/patients/{patient['id']}"

    memo = staff.admin.patch(
        patient_url,
        headers=_headers(staff.admin_csrf),
        json={
            "row_version": patient["row_version"],
            "reason": "연락처 갱신",
            "phone": "010-0000-0000",
            "special_notes": "합성 특이사항",
        },
    )
    assert memo.status_code == 200, memo.text
    assert _status(staff.admin, appointment["id"])["state"] == "VERIFIED"

    renamed = staff.admin.patch(
        patient_url,
        headers=_headers(staff.admin_csrf),
        json={
            "row_version": memo.json()["patient"]["row_version"],
            "reason": "이름 오기 정정",
            "name": "합성정정환자",
        },
    )
    assert renamed.status_code == 200, renamed.text
    status = _status(staff.admin, appointment["id"])
    assert status["state"] == "REVERIFY_REQUIRED"
    assert "이름" in status["last_invalidation"]["invalidation_reason"]
    assert status["history"][0]["subject"]["name"] == "합성확인환자"
    assert status["current"]["name"] == "합성정정환자"


def test_failed_changes_keep_original_data_and_verifications(staff: Staff) -> None:
    patient, appointment = _verified(staff)
    other = _patient(staff, chart_number="SYN-VER-002")
    _book(staff, str(other["id"]), start_time="10:00")

    conflict = staff.admin.patch(
        f"/api/appointments/{appointment['id']}",
        headers=_headers(staff.admin_csrf),
        json={"row_version": appointment["row_version"], "reason": "충돌 시험", "start_time": "10:00"},
    )
    assert conflict.status_code == 409
    duplicate_chart = staff.admin.patch(
        f"/api/patients/{patient['id']}",
        headers=_headers(staff.admin_csrf),
        json={"row_version": patient["row_version"], "reason": "중복 시험", "chart_number": "SYN-VER-002"},
    )
    assert duplicate_chart.status_code == 409

    status = _status(staff.admin, appointment["id"])
    assert status["state"] == "VERIFIED"
    assert status["current"]["start_time"] == "09:00"
    assert status["current"]["chart_number"] == "SYN-VER-001"


def test_invalidation_rolls_back_with_the_change_in_one_transaction(
    staff: Staff, session_factory: sessionmaker[Session]
) -> None:
    """변경과 무효화가 같은 Transaction이라, Commit 전에 실패하면 둘 다 되돌아간다."""

    _, appointment = _verified(staff)
    appointment_id = UUID(str(appointment["id"]))
    with session_factory() as db:
        change_appointment(
            db,
            appointment_id=appointment_id,
            row_version=int(appointment["row_version"]),
            reason="Commit 직전 실패 시험",
            actor_user_id=staff.admin_id,
            start_time=time(11, 0),
        )
        invalid_now = db.scalars(
            select(PatientVerification).where(
                PatientVerification.appointment_id == appointment_id,
                PatientVerification.is_valid.is_(False),
            )
        ).all()
        assert len(invalid_now) == 2
        db.rollback()

    status = _status(staff.admin, appointment_id)
    assert status["state"] == "VERIFIED"
    assert status["current"]["start_time"] == "09:00"


def test_cancelled_and_no_show_appointments_refuse_new_verification(staff: Staff) -> None:
    patient = _patient(staff)
    appointment = _book(staff, str(patient["id"]))
    fingerprint = _status(staff.admin, appointment["id"])["fingerprint"]
    cancelled = staff.admin.post(
        f"/api/appointments/{appointment['id']}/cancel",
        headers=_headers(staff.admin_csrf),
        json={"row_version": appointment["row_version"], "reason": "환자 사정"},
    )
    assert cancelled.status_code == 200, cancelled.text
    refused = _verify(staff.admin, staff.admin_csrf, appointment["id"], "primary", fingerprint)
    assert refused.status_code == 409
    assert refused.json()["code"] == "APPOINTMENT_NOT_ACTIVE"


def test_screening_snapshot_records_screening_year_age(staff: Staff) -> None:
    patient = _patient(staff)
    appointment = _book(staff, str(patient["id"]), care_type="SCREENING")
    status = _status(staff.admin, appointment["id"])
    primary = _verify(staff.admin, staff.admin_csrf, appointment["id"], "primary", status["fingerprint"])
    subject = primary.json()["primary"]["subject"]
    assert subject["age_method"] == "SCREENING_YEAR_AGE"
    # 12월 31일생이라 검진 연도나이와 만 나이가 달라지는 경계를 고정한다.
    assert subject["computed_age"] == BOOKING_DAY.year - 1980


def test_role_definitions_grant_primary_to_admin_and_front_desk_only() -> None:
    assert "verification.primary" in ROLE_DEFINITIONS["ADMIN"][1]
    assert "verification.primary" in ROLE_DEFINITIONS["FRONT_DESK"][1]
    assert "verification.primary" not in ROLE_DEFINITIONS["ENDOSCOPY_STAFF"][1]
    assert "verification.primary" not in ROLE_DEFINITIONS["READ_ONLY"][1]
    assert "verification.secondary" in ROLE_DEFINITIONS["ENDOSCOPY_STAFF"][1]

