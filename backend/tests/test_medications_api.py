"""Sprint 4B 대장내시경 복용약 확인·약별 의사 결정 API Test(합성 계정·환자·약만 사용)."""

from __future__ import annotations

from collections.abc import Generator
from dataclasses import dataclass
from datetime import date, timedelta
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.cli.seed_identity import ROLE_DEFINITIONS
from app.core.clock import today_in_seoul
from app.core.config import Settings
from app.core.security import hash_password
from app.db.session import get_db
from app.main import create_app
from app.models import (
    MedicationItem,
    Permission,
    Role,
    RolePermission,
    StaffProfile,
    User,
    UserRole,
)
from tests.conftest import (
    ADMIN_PASSWORD,
    BOOKING_DAY,
    NEXT_BOOKING_DAY,
    TEST_ORIGIN,
    SeededIdentity,
    iso,
)

DESK_LOGIN = "desk.test"
VIEWER_LOGIN = "viewer.test"
STAFF_PASSWORD = "Synthetic-Staff-Password-42!"
COLON = [{"procedure_code": "COLON", "sedation_mode": "SEDATED"}]
UPPER = [{"procedure_code": "UPPER", "sedation_mode": "SEDATED"}]


@dataclass
class Staff:
    admin: TestClient
    admin_csrf: str
    desk: TestClient
    desk_csrf: str
    viewer: TestClient
    doctor_id: UUID
    nurse_id: UUID
    retired_doctor_id: UUID


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


def _user(db: Session, login_id: str, name: str, role: Role) -> None:
    user = User(
        login_id_normalized=login_id,
        password_hash=hash_password(STAFF_PASSWORD),
        display_name=name,
        is_active=True,
        must_change_password=False,
    )
    user.role_assignments = [UserRole(role=role)]
    db.add(user)


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
    """관리자(모든 권한), 원무(확인·안내만, 결정 없음), 조회 전용과 의료진 명부를 만든다."""

    with session_factory() as db:
        admin_role = db.get(Role, seeded_identity.role_id)
        assert admin_role is not None
        _grant(
            db,
            admin_role,
            [
                "appointment.update",
                "appointment.cancel",
                "medication.read",
                "medication.write",
                "medication.decision",
            ],
        )
        desk_role = Role(code="DESK_TEST", name_ko="원무 Test", is_active=True)
        viewer_role = Role(code="READ_ONLY", name_ko="조회 전용", is_active=True)
        db.add_all([desk_role, viewer_role])
        db.flush()
        _grant(
            db,
            desk_role,
            ["appointment.read", "patient.read", "medication.read", "medication.write"],
        )
        _grant(db, viewer_role, ["appointment.read", "patient.read"])
        _user(db, DESK_LOGIN, "합성 원무 담당", desk_role)
        _user(db, VIEWER_LOGIN, "합성 조회 담당", viewer_role)
        doctor = StaffProfile(display_name="합성 원장", staff_type="DOCTOR", is_active=True)
        nurse = StaffProfile(display_name="합성 간호사", staff_type="NURSE", is_active=True)
        retired = StaffProfile(
            display_name="합성 전임 의사", staff_type="DOCTOR", is_active=False
        )
        db.add_all([doctor, nurse, retired])
        db.commit()
        ids = (doctor.id, nurse.id, retired.id)
    admin, admin_csrf = _login(app, "admin.test", ADMIN_PASSWORD)
    desk, desk_csrf = _login(app, DESK_LOGIN, STAFF_PASSWORD)
    viewer, _ = _login(app, VIEWER_LOGIN, STAFF_PASSWORD)
    return Staff(
        admin=admin,
        admin_csrf=admin_csrf,
        desk=desk,
        desk_csrf=desk_csrf,
        viewer=viewer,
        doctor_id=ids[0],
        nurse_id=ids[1],
        retired_doctor_id=ids[2],
    )


def _headers(csrf_token: str) -> dict[str, str]:
    return {"Origin": TEST_ORIGIN, "X-CSRF-Token": csrf_token}


def _book(
    staff: Staff,
    *,
    procedures: list[dict[str, str]] = COLON,
    chart: str = "SYN-MED-001",
    start_time: str = "09:00",
) -> dict[str, object]:
    patient = staff.admin.post(
        "/api/patients",
        headers=_headers(staff.admin_csrf),
        json={
            "chart_number": chart,
            "name": "합성약제환자",
            "birth_date": "1970-05-05",
            "sex": "MALE",
        },
    )
    assert patient.status_code == 201, patient.text
    response = staff.admin.post(
        "/api/appointments",
        headers=_headers(staff.admin_csrf),
        json={
            "patient_id": patient.json()["patient"]["id"],
            "service_date": iso(BOOKING_DAY),
            "start_time": start_time,
            "care_type": "GENERAL",
            "procedures": procedures,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _url(appointment: dict[str, object], suffix: str = "") -> str:
    return f"/api/appointments/{appointment['id']}/medication-review{suffix}"


def _review(client: TestClient, appointment: dict[str, object]) -> dict[str, object]:
    response = client.get(_url(appointment))
    assert response.status_code == 200, response.text
    return response.json()


def _checklist(
    staff: Staff,
    appointment: dict[str, object],
    *,
    expected_row_version: int | None = None,
    client: TestClient | None = None,
    csrf: str | None = None,
    **fields: object,
):
    body: dict[str, object] = {
        "medication_status": "LIST_CONFIRMED",
        "medication_list": "합성약A 1정 아침, 합성약B 1정 저녁",
        **fields,
    }
    if expected_row_version is not None:
        body["expected_row_version"] = expected_row_version
    return (client or staff.admin).put(
        _url(appointment, "/checklist"),
        headers=_headers(csrf or staff.admin_csrf),
        json=body,
    )


def _decision(staff: Staff, **overrides: object) -> dict[str, object]:
    return {
        "decision": "HOLD",
        "hold_days": 5,
        "physician_profile_id": str(staff.doctor_id),
        "physician_confirmed": True,
        **overrides,
    }


def _add(
    staff: Staff,
    appointment: dict[str, object],
    name: str = "합성약A",
    decision: dict[str, object] | None = None,
    *,
    client: TestClient | None = None,
    csrf: str | None = None,
):
    body: dict[str, object] = {"medication_name": name}
    if decision is not None:
        body["decision"] = decision
    return (client or staff.admin).post(
        _url(appointment, "/items"),
        headers=_headers(csrf or staff.admin_csrf),
        json=body,
    )


def _item_post(
    staff: Staff,
    appointment: dict[str, object],
    item: dict[str, object],
    action: str,
    body: dict[str, object] | None = None,
    *,
    client: TestClient | None = None,
    csrf: str | None = None,
):
    return (client or staff.admin).post(
        _url(appointment, f"/items/{item['item_key']}/{action}"),
        headers=_headers(csrf or staff.admin_csrf),
        json={"expected_revision": item["revision"], **(body or {})},
    )


def _only_item(review: dict[str, object]) -> dict[str, object]:
    items = review["items"]
    assert isinstance(items, list) and len(items) == 1
    return items[0]


def test_colon_booking_needs_medication_check_and_upper_only_does_not(staff: Staff) -> None:
    colon = _book(staff)
    assert colon["medication_state"] == "CHECK_REQUIRED"
    review = _review(staff.admin, colon)
    assert review["state"] == "CHECK_REQUIRED"
    assert review["has_colon"] is True
    assert review["checklist"] is None
    # 활성 의사 Profile만 결정 주체로 내려 준다.
    assert [item["display_name"] for item in review["physicians"]] == ["합성 원장"]

    upper = _book(staff, procedures=UPPER, chart="SYN-MED-002", start_time="10:30")
    assert upper["medication_state"] == "NOT_REQUIRED"
    listed = staff.admin.get(
        "/api/appointments",
        params={"start_date": iso(BOOKING_DAY), "end_date": iso(BOOKING_DAY)},
    )
    assert listed.status_code == 200, listed.text
    states = {item["id"]: item["medication_state"] for item in listed.json()["items"]}
    assert states == {colon["id"]: "CHECK_REQUIRED", upper["id"]: "NOT_REQUIRED"}


def test_checklist_separates_explicit_none_from_an_empty_list(staff: Staff) -> None:
    appointment = _book(staff)
    empty = _checklist(staff, appointment, medication_list="   ")
    assert empty.status_code == 422
    assert empty.json()["code"] == "MEDICATION_LIST_REQUIRED"

    unchecked = _checklist(
        staff, appointment, medication_status="UNCHECKED", medication_list=None
    )
    assert unchecked.status_code == 200, unchecked.text
    assert unchecked.json()["state"] == "CHECK_REQUIRED"
    assert unchecked.json()["checklist"]["confirmed_at"] is None

    conflict = _checklist(
        staff,
        appointment,
        expected_row_version=1,
        medication_status="NONE_CONFIRMED",
        medication_list=None,
        categories={"anticoagulant": True},
    )
    assert conflict.status_code == 422
    assert conflict.json()["code"] == "MEDICATION_NONE_CONFLICT"

    none = _checklist(
        staff,
        appointment,
        expected_row_version=1,
        medication_status="NONE_CONFIRMED",
        medication_list=None,
    )
    assert none.status_code == 200, none.text
    body = none.json()
    assert body["state"] == "COMPLETE"
    assert body["checklist"]["medication_status"] == "NONE_CONFIRMED"
    assert body["checklist"]["confirmed_by_name"] == "합성 관리자"
    assert body["checklist"]["row_version"] == 2


def test_checklist_keeps_every_saved_version_and_rejects_stale_screens(staff: Staff) -> None:
    appointment = _book(staff)
    first = _checklist(
        staff,
        appointment,
        categories={"antiplatelet": True, "chronic_disease": True},
        surgery_history="합성 충수절제술(2010)",
        emr_recorded=True,
    )
    assert first.status_code == 200, first.text
    checklist = first.json()["checklist"]
    assert checklist["categories"]["antiplatelet"] is True
    assert checklist["categories"]["chronic_disease"] is True
    assert checklist["categories"]["anticoagulant"] is False
    assert checklist["surgery_history"] == "합성 충수절제술(2010)"
    assert checklist["emr_recorded"] is True

    # 처음 화면을 연 다른 사용자는 이미 저장된 확인을 덮어쓸 수 없다.
    stale = _checklist(staff, appointment, medication_list="다른 목록")
    assert stale.status_code == 409
    assert stale.json()["code"] == "MEDICATION_REVIEW_STALE"

    second = _checklist(
        staff, appointment, expected_row_version=1, medication_list="합성약C 1정 아침"
    )
    assert second.status_code == 200, second.text
    history = second.json()["checklist_history"]
    assert [entry["revision"] for entry in history] == [2, 1]
    assert history[0]["snapshot"]["medication_list"] == "합성약C 1정 아침"
    # 이전 Revision의 값은 그대로 남는다.
    assert history[1]["snapshot"]["medication_list"] == "합성약A 1정 아침, 합성약B 1정 저녁"
    assert history[1]["snapshot"]["categories"]["antiplatelet"] is True
    assert history[1]["saved_by_name"] == "합성 관리자"


def test_physician_decision_records_the_doctor_and_the_input_user(staff: Staff) -> None:
    appointment = _book(staff)
    assert _checklist(staff, appointment, categories={"antiplatelet": True}).status_code == 200
    pending = _add(staff, appointment, "합성 항혈소판제")
    assert pending.status_code == 201, pending.text
    assert pending.json()["state"] == "PHYSICIAN_REQUIRED"
    item = _only_item(pending.json())
    assert item["decision"] == "PENDING"
    assert item["physician_name"] is None

    decided = _item_post(staff, appointment, item, "decision", _decision(staff, hold_days=7))
    assert decided.status_code == 200, decided.text
    body = decided.json()
    assert body["state"] == "NOTIFICATION_REQUIRED"
    current = _only_item(body)
    assert current["revision"] == 2
    assert current["decision"] == "HOLD"
    assert current["hold_days"] == 7
    assert current["physician_name"] == "합성 원장"
    assert current["recorded_by_name"] == "합성 관리자"
    assert current["decided_for_service_date"] == iso(BOOKING_DAY)
    assert current["needs_re_review"] is False
    # 결정 전 행은 지우지 않고 SUPERSEDED로 남는다.
    history = body["item_history"]
    assert [(entry["revision"], entry["status"]) for entry in history] == [
        (2, "ACTIVE"),
        (1, "SUPERSEDED"),
    ]

    notified = _item_post(staff, appointment, current, "notify")
    assert notified.status_code == 200, notified.text
    assert notified.json()["state"] == "COMPLETE"
    assert _only_item(notified.json())["patient_notified_by_name"] == "합성 관리자"


def test_decision_needs_an_active_doctor_and_explicit_confirmation(staff: Staff) -> None:
    appointment = _book(staff)
    assert _checklist(staff, appointment).status_code == 200

    unconfirmed = _add(staff, appointment, decision=_decision(staff, physician_confirmed=False))
    assert unconfirmed.status_code == 422
    assert unconfirmed.json()["code"] == "PHYSICIAN_CONFIRMATION_REQUIRED"

    for profile_id in (staff.nurse_id, staff.retired_doctor_id):
        invalid = _add(
            staff,
            appointment,
            decision=_decision(staff, physician_profile_id=str(profile_id)),
        )
        assert invalid.status_code == 422
        assert invalid.json()["code"] == "PHYSICIAN_CONFIRMATION_INVALID"

    no_days = _add(staff, appointment, decision=_decision(staff, hold_days=None))
    assert no_days.status_code == 422
    assert no_days.json()["code"] == "MEDICATION_HOLD_DAYS_INVALID"
    for days in (0, 91):
        out_of_range = _add(staff, appointment, decision=_decision(staff, hold_days=days))
        assert out_of_range.status_code == 422

    no_reason = _add(
        staff, appointment, decision=_decision(staff, decision="CONTINUE", hold_days=None)
    )
    assert no_reason.status_code == 422
    assert no_reason.json()["code"] == "MEDICATION_RATIONALE_REQUIRED"

    # 실패한 요청은 아무 행도 남기지 않는다.
    assert _review(staff.admin, appointment)["item_history"] == []

    continued = _add(
        staff,
        appointment,
        "합성 아스피린",
        _decision(staff, decision="CONTINUE", hold_days=None, rationale="심혈관 위험으로 지속"),
    )
    assert continued.status_code == 201, continued.text
    item = _only_item(continued.json())
    assert item["decision"] == "CONTINUE"
    assert item["hold_days"] is None
    assert item["rationale"] == "심혈관 위험으로 지속"


def test_permissions_and_csrf_are_enforced(staff: Staff) -> None:
    appointment = _book(staff)
    # 조회 전용 사용자는 복용약 내용을 볼 수 없다.
    assert staff.viewer.get(_url(appointment)).status_code == 403

    # 원무는 확인과 검토 대상 추가는 하지만 의사 결정은 기록하지 못한다.
    saved = _checklist(staff, appointment, client=staff.desk, csrf=staff.desk_csrf)
    assert saved.status_code == 200, saved.text
    pending = _add(staff, appointment, client=staff.desk, csrf=staff.desk_csrf)
    assert pending.status_code == 201, pending.text
    with_decision = _add(
        staff, appointment, decision=_decision(staff), client=staff.desk, csrf=staff.desk_csrf
    )
    assert with_decision.status_code == 403
    assert with_decision.json()["code"] == "PERMISSION_DENIED"
    item = _only_item(pending.json())
    denied = _item_post(
        staff, appointment, item, "decision", _decision(staff), client=staff.desk, csrf=staff.desk_csrf
    )
    assert denied.status_code == 403

    no_csrf = staff.admin.put(
        _url(appointment, "/checklist"),
        headers={"Origin": TEST_ORIGIN},
        json={"medication_status": "UNCHECKED"},
    )
    assert no_csrf.status_code == 403
    assert no_csrf.json()["code"] == "CSRF_TOKEN_INVALID"


def test_date_change_asks_for_re_review_and_keeps_the_previous_decision(
    staff: Staff,
) -> None:
    appointment = _book(staff)
    assert _checklist(staff, appointment).status_code == 200
    added = _add(staff, appointment, "합성 항응고제", _decision(staff, hold_days=5))
    first = _only_item(added.json())
    assert _item_post(staff, appointment, first, "notify").status_code == 200

    # 같은 날 안에서 시각만 바꾸면 결정은 그대로 유효하다.
    moved = staff.admin.patch(
        f"/api/appointments/{appointment['id']}",
        headers=_headers(staff.admin_csrf),
        json={"row_version": appointment["row_version"], "reason": "시각 조정", "start_time": "10:00"},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["medication_state"] == "COMPLETE"

    rescheduled = staff.admin.patch(
        f"/api/appointments/{appointment['id']}",
        headers=_headers(staff.admin_csrf),
        json={
            "row_version": moved.json()["row_version"],
            "reason": "환자 요청으로 날짜 변경",
            "service_date": iso(NEXT_BOOKING_DAY),
        },
    )
    assert rescheduled.status_code == 200, rescheduled.text
    assert rescheduled.json()["medication_state"] == "RE_REVIEW_REQUIRED"

    review = _review(staff.admin, appointment)
    assert review["state"] == "RE_REVIEW_REQUIRED"
    outdated = _only_item(review)
    assert outdated["needs_re_review"] is True
    assert outdated["decided_for_service_date"] == iso(BOOKING_DAY)
    for action, body in (("notify", None), ("hold-confirmation", {"confirmed_on": iso(today_in_seoul())})):
        refused = _item_post(staff, appointment, outdated, action, body)
        assert refused.status_code == 409
        assert refused.json()["code"] == "MEDICATION_RE_REVIEW_REQUIRED"

    # 시스템은 새 중단일을 정하지 않는다. 의사가 다시 결정해야 한다.
    redecided = _item_post(staff, appointment, outdated, "decision", _decision(staff, hold_days=3))
    assert redecided.status_code == 200, redecided.text
    body = redecided.json()
    assert body["state"] == "NOTIFICATION_REQUIRED"
    current = _only_item(body)
    assert current["hold_days"] == 3
    assert current["decided_for_service_date"] == iso(NEXT_BOOKING_DAY)
    assert current["patient_notified_at"] is None
    previous = body["item_history"][1]
    assert previous["status"] == "SUPERSEDED"
    assert previous["hold_days"] == 5
    assert previous["patient_notified_by_name"] == "합성 관리자"


def test_notification_and_hold_confirmation_follow_the_decision(staff: Staff) -> None:
    appointment = _book(staff)
    assert _checklist(staff, appointment).status_code == 200
    pending = _only_item(_add(staff, appointment, "합성 혈액순환제").json())
    early = _item_post(staff, appointment, pending, "notify")
    assert early.status_code == 409
    assert early.json()["code"] == "MEDICATION_DECISION_REQUIRED"

    continued = _item_post(
        staff,
        appointment,
        pending,
        "decision",
        _decision(staff, decision="CONTINUE", hold_days=None, rationale="지속 유지"),
    )
    kept = _only_item(continued.json())
    not_hold = _item_post(
        staff, appointment, kept, "hold-confirmation", {"confirmed_on": iso(today_in_seoul())}
    )
    assert not_hold.status_code == 409
    assert not_hold.json()["code"] == "MEDICATION_HOLD_REQUIRED"

    held = _only_item(
        _item_post(staff, appointment, kept, "decision", _decision(staff, hold_days=2)).json()
    )
    stale = _item_post(staff, appointment, kept, "notify")
    assert stale.status_code == 409
    assert stale.json()["code"] == "MEDICATION_ITEM_STALE"

    today = today_in_seoul()
    for invalid in (today - timedelta(days=1), today + timedelta(days=1)):
        refused = _item_post(
            staff, appointment, held, "hold-confirmation", {"confirmed_on": iso(invalid)}
        )
        assert refused.status_code == 422
        assert refused.json()["code"] == "HOLD_CONFIRMATION_DATE_INVALID"
    confirmed = _item_post(
        staff, appointment, held, "hold-confirmation", {"confirmed_on": iso(today)}
    )
    assert confirmed.status_code == 200, confirmed.text
    current = _only_item(confirmed.json())
    assert current["hold_confirmed_on"] == iso(today)
    assert current["hold_confirmed_by_name"] == "합성 관리자"
    again = _item_post(staff, appointment, current, "hold-confirmation", {"confirmed_on": iso(today)})
    assert again.status_code == 409

    assert _item_post(staff, appointment, current, "notify").status_code == 200
    duplicate = _item_post(staff, appointment, current, "notify")
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "MEDICATION_ALREADY_NOTIFIED"


def test_withdrawal_needs_a_reason_and_none_status_needs_no_active_items(
    staff: Staff,
) -> None:
    appointment = _book(staff)
    assert _checklist(staff, appointment).status_code == 200
    item = _only_item(_add(staff, appointment, "합성 오기입약").json())

    blocked = _checklist(
        staff,
        appointment,
        expected_row_version=1,
        medication_status="NONE_CONFIRMED",
        medication_list=None,
    )
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "MEDICATION_ITEMS_EXIST"

    assert _item_post(staff, appointment, item, "withdraw", {"reason": "   "}).status_code == 422
    withdrawn = _item_post(staff, appointment, item, "withdraw", {"reason": "다른 환자 약을 잘못 입력"})
    assert withdrawn.status_code == 200, withdrawn.text
    body = withdrawn.json()
    assert body["items"] == []
    assert body["item_history"][0]["status"] == "WITHDRAWN"
    assert body["item_history"][0]["end_reason"] == "다른 환자 약을 잘못 입력"
    assert body["item_history"][0]["medication_name"] == "합성 오기입약"

    none = _checklist(
        staff,
        appointment,
        expected_row_version=1,
        medication_status="NONE_CONFIRMED",
        medication_list=None,
    )
    assert none.status_code == 200, none.text
    refused = _add(staff, appointment, "합성약D")
    assert refused.status_code == 409
    assert refused.json()["code"] == "MEDICATION_NONE_CONFIRMED"


def test_items_need_a_checklist_and_an_active_appointment(staff: Staff) -> None:
    appointment = _book(staff)
    early = _add(staff, appointment)
    assert early.status_code == 409
    assert early.json()["code"] == "MEDICATION_CHECKLIST_REQUIRED"

    assert _checklist(staff, appointment).status_code == 200
    cancelled = staff.admin.post(
        f"/api/appointments/{appointment['id']}/cancel",
        headers=_headers(staff.admin_csrf),
        json={"row_version": appointment["row_version"], "reason": "환자 사정"},
    )
    assert cancelled.status_code == 200, cancelled.text
    refused = _checklist(staff, appointment, expected_row_version=1)
    assert refused.status_code == 409
    assert refused.json()["code"] == "APPOINTMENT_NOT_ACTIVE"
    # 지난 기록은 계속 조회할 수 있다.
    assert _review(staff.admin, appointment)["checklist"]["row_version"] == 1


def test_duplicate_active_revision_is_blocked_by_the_partial_unique_index(
    staff: Staff, session_factory: sessionmaker[Session]
) -> None:
    appointment = _book(staff)
    assert _checklist(staff, appointment).status_code == 200
    item = _only_item(_add(staff, appointment).json())
    with session_factory() as db:
        current = db.scalar(select(MedicationItem).where(MedicationItem.id == UUID(str(item["id"]))))
        assert current is not None
        db.add(
            MedicationItem(
                review_id=current.review_id,
                item_key=current.item_key,
                revision=2,
                status="ACTIVE",
                medication_name_ciphertext=current.medication_name_ciphertext,
                decision="PENDING",
                recorded_by_user_id=current.recorded_by_user_id,
                recorded_at=current.recorded_at,
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()


def test_staff_profiles_are_managed_by_identity_admins(staff: Staff) -> None:
    created = staff.admin.post(
        "/api/staff-profiles",
        headers=_headers(staff.admin_csrf),
        json={"display_name": "합성 새 원장", "staff_type": "DOCTOR"},
    )
    assert created.status_code == 201, created.text
    profile = created.json()
    assert profile["is_active"] is True

    listed = staff.admin.get("/api/staff-profiles", params={"staff_type": "DOCTOR"})
    assert listed.status_code == 200, listed.text
    assert {item["display_name"] for item in listed.json()["items"]} == {"합성 원장", "합성 새 원장"}

    physicians = staff.desk.get("/api/staff-profiles/physicians")
    assert physicians.status_code == 200, physicians.text
    assert len(physicians.json()["items"]) == 2

    deactivated = staff.admin.patch(
        f"/api/staff-profiles/{profile['id']}/activation",
        headers=_headers(staff.admin_csrf),
        json={"is_active": False},
    )
    assert deactivated.status_code == 200, deactivated.text
    assert deactivated.json()["deactivated_at"] is not None
    assert [item["display_name"] for item in staff.desk.get("/api/staff-profiles/physicians").json()["items"]] == ["합성 원장"]

    # 원무는 명부를 관리하지 못하고, 조회 전용은 의사 목록도 받지 못한다.
    assert staff.desk.get("/api/staff-profiles").status_code == 403
    assert (
        staff.desk.post(
            "/api/staff-profiles",
            headers=_headers(staff.desk_csrf),
            json={"display_name": "합성", "staff_type": "DOCTOR"},
        ).status_code
        == 403
    )
    assert staff.viewer.get("/api/staff-profiles/physicians").status_code == 403


def test_role_definitions_grant_medication_permissions_to_clinical_roles() -> None:
    codes = ("medication.read", "medication.write", "medication.decision")
    for role in ("ADMIN", "FRONT_DESK", "ENDOSCOPY_STAFF"):
        assert set(codes) <= ROLE_DEFINITIONS[role][1], role
    assert not set(codes) & ROLE_DEFINITIONS["READ_ONLY"][1]


def test_service_date_is_compared_by_date_only(staff: Staff) -> None:
    """검사일이 같으면 결정 당시와 지금의 비교가 흔들리지 않는다(날짜 형식 회귀 방지)."""

    appointment = _book(staff)
    assert _checklist(staff, appointment).status_code == 200
    item = _only_item(_add(staff, appointment, decision=_decision(staff)).json())
    assert date.fromisoformat(str(item["decided_for_service_date"])) == BOOKING_DAY
    assert item["needs_re_review"] is False
