from __future__ import annotations

from datetime import timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.core.security import hash_password
from app.models import (
    Appointment,
    Permission,
    Role,
    RolePermission,
    User,
    UserRole,
)
from tests.conftest import (
    BOOKING_DAY,
    CLOSED_SUNDAY,
    FAR_FUTURE_DAY,
    NEXT_BOOKING_DAY,
    OVERRIDE_DAY,
    SHORT_DAY,
    TEST_ORIGIN,
    SeededIdentity,
    iso,
    login_admin,
)

SCHEDULING_PERMISSIONS = (
    "appointment.update",
    "appointment.cancel",
    "appointment.no_show",
    "schedule_override.approve",
)
SECOND_ADMIN_LOGIN = "admin2.test"
SECOND_ADMIN_PASSWORD = "Synthetic-Second-Admin-Password-42!"
UPPER = [{"procedure_code": "UPPER", "sedation_mode": "SEDATED"}]
COLON = [{"procedure_code": "COLON", "sedation_mode": "NON_SEDATED"}]


@pytest.fixture
def scheduling_admins(
    session_factory: sessionmaker[Session],
    seeded_identity: SeededIdentity,
) -> SeededIdentity:
    """합성 관리자에게 Sprint 3B 권한을 주고 오후 예외 확인용 관리자를 추가한다."""

    with session_factory() as db:
        role = db.get(Role, seeded_identity.role_id)
        assert role is not None
        for code in SCHEDULING_PERMISSIONS:
            role.permission_assignments.append(
                RolePermission(permission=Permission(code=code, description_ko=code))
            )
        second_admin = User(
            login_id_normalized=SECOND_ADMIN_LOGIN,
            password_hash=hash_password(SECOND_ADMIN_PASSWORD),
            display_name="합성 관리자 2",
            is_active=True,
            must_change_password=False,
        )
        second_admin.role_assignments = [UserRole(role=role)]
        db.add(second_admin)
        db.commit()
    return seeded_identity


def _shift_appointment_into_past(
    session_factory: sessionmaker[Session], appointment_id: str, *, days: int = 7
) -> None:
    """예약 시각이 이미 지난 상황을 만든다. 같은 요일로 옮겨 운영규칙은 유지한다."""

    with session_factory() as db:
        appointment = db.get(Appointment, UUID(appointment_id))
        assert appointment is not None
        appointment.service_date -= timedelta(days=days)
        appointment.scheduled_start_at -= timedelta(days=days)
        appointment.scheduled_end_at -= timedelta(days=days)
        db.commit()


def _headers(csrf_token: str) -> dict[str, str]:
    return {"Origin": TEST_ORIGIN, "X-CSRF-Token": csrf_token}


def _login_admin(client: TestClient) -> str:
    return str(login_admin(client)["csrf_token"])


def _login_second_admin(client: TestClient) -> str:
    response = client.post(
        "/api/auth/login",
        headers={"Origin": TEST_ORIGIN},
        json={"login_id": SECOND_ADMIN_LOGIN, "password": SECOND_ADMIN_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return str(response.json()["csrf_token"])


def _create_patient(client: TestClient, csrf_token: str) -> str:
    response = client.post(
        "/api/patients",
        headers=_headers(csrf_token),
        json={
            "chart_number": "SYN-CHG-001",
            "name": "합성변경환자",
            "birth_date": "1975-03-03",
            "sex": "MALE",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["patient"]["id"]


def _book(
    client: TestClient,
    csrf_token: str,
    patient_id: str,
    *,
    service_date: str,
    start_time: str,
    procedures: list[dict[str, str]] = UPPER,
    booking_bucket: str = "STANDARD_MORNING",
    exception_reason: str | None = None,
):
    payload: dict[str, object] = {
        "patient_id": patient_id,
        "service_date": service_date,
        "start_time": start_time,
        "care_type": "GENERAL",
        "booking_bucket": booking_bucket,
        "procedures": procedures,
    }
    if exception_reason is not None:
        payload["exception_reason"] = exception_reason
    return client.post(
        "/api/appointments", headers=_headers(csrf_token), json=payload
    )


def _approved_override(
    client: TestClient, csrf_token: str, **values: object
) -> dict[str, object]:
    created = client.post(
        "/api/schedule/overrides",
        headers=_headers(csrf_token),
        json={"reason": "합성 일정 예외", **values},
    )
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "PENDING"
    approved = client.post(
        f"/api/schedule/overrides/{created.json()['id']}/approve",
        headers=_headers(csrf_token),
    )
    assert approved.status_code == 200, approved.text
    return approved.json()


def _availability(
    client: TestClient,
    service_date: str,
    procedure_codes: list[str],
    booking_bucket: str = "STANDARD_MORNING",
):
    return client.get(
        "/api/appointments/availability",
        params=[
            ("service_date", service_date),
            *[("procedures", code) for code in procedure_codes],
            ("booking_bucket", booking_bucket),
        ],
    )


def test_change_keeps_same_appointment_and_records_revision(
    client: TestClient, scheduling_admins: SeededIdentity
) -> None:
    csrf_token = _login_admin(client)
    patient_id = _create_patient(client, csrf_token)
    booked = _book(
        client, csrf_token, patient_id, service_date=iso(BOOKING_DAY), start_time="09:00"
    )
    assert booked.status_code == 201, booked.text
    appointment_id = booked.json()["id"]

    changed = client.patch(
        f"/api/appointments/{appointment_id}",
        headers=_headers(csrf_token),
        json={"row_version": 1, "reason": "환자 요청으로 시간 변경", "start_time": "10:00"},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["id"] == appointment_id
    assert changed.json()["start_time"] == "10:00:00"
    assert changed.json()["row_version"] == 2

    # 이전 시간은 해제되어 다른 예약이 들어갈 수 있다.
    freed = _book(
        client, csrf_token, patient_id, service_date=iso(BOOKING_DAY), start_time="09:00"
    )
    assert freed.status_code == 201, freed.text

    history = client.get(f"/api/appointments/{appointment_id}/history")
    assert history.status_code == 200, history.text
    events = history.json()
    assert [event["event_type"] for event in events] == ["CREATED", "UPDATED"]
    assert events[1]["before_values"]["start_time"] == "09:00"
    assert events[1]["after_values"]["start_time"] == "10:00"
    assert "start_time" in events[1]["changed_fields"]
    assert events[1]["reason"] == "환자 요청으로 시간 변경"


def test_stale_or_conflicting_change_leaves_appointment_unchanged(
    client: TestClient, scheduling_admins: SeededIdentity
) -> None:
    csrf_token = _login_admin(client)
    patient_id = _create_patient(client, csrf_token)
    assert _book(
        client, csrf_token, patient_id,
        service_date=iso(BOOKING_DAY), start_time="09:00", procedures=COLON,
    ).status_code == 201
    second = _book(
        client, csrf_token, patient_id, service_date=iso(BOOKING_DAY), start_time="10:00"
    )
    assert second.status_code == 201, second.text
    url = f"/api/appointments/{second.json()['id']}"

    stale = client.patch(
        url,
        headers=_headers(csrf_token),
        json={"row_version": 2, "reason": "변경", "start_time": "10:30"},
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "STALE_ROW_VERSION"

    conflict = client.patch(
        url,
        headers=_headers(csrf_token),
        json={"row_version": 1, "reason": "변경", "start_time": "09:30"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "TIME_CONFLICT"
    assert client.get(url).json()["start_time"] == "10:00:00"

    # 자기 자신은 충돌 검사에서 제외되어 같은 시간의 수면 변경이 가능하다.
    sedation = client.patch(
        url,
        headers=_headers(csrf_token),
        json={
            "row_version": 1,
            "reason": "비수면으로 변경",
            "procedures": [{"procedure_code": "UPPER", "sedation_mode": "NON_SEDATED"}],
        },
    )
    assert sedation.status_code == 200, sedation.text
    assert sedation.json()["procedures"][0]["sedation_mode"] == "NON_SEDATED"

    no_change = client.patch(
        url,
        headers=_headers(csrf_token),
        json={"row_version": 2, "reason": "변경", "start_time": "10:00"},
    )
    assert no_change.status_code == 422
    assert no_change.json()["code"] == "APPOINTMENT_NO_CHANGES"


def test_cancel_releases_capacity_and_blocks_further_changes(
    client: TestClient, scheduling_admins: SeededIdentity
) -> None:
    csrf_token = _login_admin(client)
    patient_id = _create_patient(client, csrf_token)
    booked_ids = []
    for start_time in ("09:00", "09:30", "10:00", "10:30", "11:00"):
        response = _book(
            client, csrf_token, patient_id,
            service_date=iso(BOOKING_DAY), start_time=start_time,
        )
        assert response.status_code == 201, response.text
        booked_ids.append(response.json()["id"])

    assert _book(
        client, csrf_token, patient_id, service_date=iso(BOOKING_DAY), start_time="11:30"
    ).json()["code"] == "CAPACITY_EXCEEDED"

    cancelled = client.post(
        f"/api/appointments/{booked_ids[-1]}/cancel",
        headers=_headers(csrf_token),
        json={"row_version": 1, "reason": "환자 사정으로 취소"},
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["workflow_state"] == "CANCELLED"

    assert _book(
        client, csrf_token, patient_id, service_date=iso(BOOKING_DAY), start_time="11:30"
    ).status_code == 201

    again = client.post(
        f"/api/appointments/{booked_ids[-1]}/cancel",
        headers=_headers(csrf_token),
        json={"row_version": 2, "reason": "중복 취소"},
    )
    assert again.status_code == 409
    assert again.json()["code"] == "APPOINTMENT_NOT_ACTIVE"

    change_cancelled = client.patch(
        f"/api/appointments/{booked_ids[-1]}",
        headers=_headers(csrf_token),
        json={"row_version": 2, "reason": "변경", "start_time": "09:00"},
    )
    assert change_cancelled.status_code == 409
    assert change_cancelled.json()["code"] == "APPOINTMENT_NOT_ACTIVE"


def test_no_show_requires_start_time_to_pass(
    client: TestClient,
    session_factory: sessionmaker[Session],
    scheduling_admins: SeededIdentity,
) -> None:
    csrf_token = _login_admin(client)
    patient_id = _create_patient(client, csrf_token)
    booked = _book(
        client, csrf_token, patient_id, service_date=iso(BOOKING_DAY), start_time="09:00"
    )
    future = _book(
        client, csrf_token, patient_id, service_date=iso(FAR_FUTURE_DAY), start_time="09:00"
    )
    assert booked.status_code == future.status_code == 201

    for appointment_id in (booked.json()["id"], future.json()["id"]):
        too_early = client.post(
            f"/api/appointments/{appointment_id}/no-show",
            headers=_headers(csrf_token),
            json={"row_version": 1, "reason": "미내원"},
        )
        assert too_early.status_code == 409
        assert too_early.json()["code"] == "NO_SHOW_TOO_EARLY"

    # 예약 API는 지난 날짜 등록을 막으므로, 미래로 등록한 예약의 시각만 Database에서
    # 과거로 옮겨 "예약 시각이 이미 지난" 상황을 만든다.
    _shift_appointment_into_past(session_factory, booked.json()["id"])

    recorded = client.post(
        f"/api/appointments/{booked.json()['id']}/no-show",
        headers=_headers(csrf_token),
        json={"row_version": 1, "reason": "연락 없이 미내원"},
    )
    assert recorded.status_code == 200, recorded.text
    assert recorded.json()["workflow_state"] == "NO_SHOW"

    with session_factory() as db:
        stored = db.get(Appointment, UUID(booked.json()["id"]))
        assert stored is not None
        # 행은 남기고 Slot 점유만 해제한다(DEC-04).
        assert stored.occupies_slot is False

    # Slot이 풀렸으므로 같은 시간대를 다시 예약할 수 있다.
    assert _book(
        client, csrf_token, patient_id, service_date=iso(BOOKING_DAY), start_time="09:00"
    ).status_code == 201


def test_closed_override_blocks_booking_until_revoked(
    client: TestClient, scheduling_admins: SeededIdentity
) -> None:
    csrf_token = _login_admin(client)
    patient_id = _create_patient(client, csrf_token)
    decision = _approved_override(
        client, csrf_token, service_date=iso(OVERRIDE_DAY), rule_type="CLOSED"
    )
    assert decision["override"]["status"] == "APPROVED"
    assert decision["impacted_appointments"] == []

    closed = _availability(client, iso(OVERRIDE_DAY), ["UPPER"])
    assert closed.status_code == 409
    assert closed.json()["code"] == "SCHEDULE_CLOSED"
    blocked = _book(
        client, csrf_token, patient_id, service_date=iso(OVERRIDE_DAY), start_time="09:00"
    )
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "SCHEDULE_CLOSED"

    revoked = client.post(
        f"/api/schedule/overrides/{decision['override']['id']}/revoke",
        headers=_headers(csrf_token),
        json={"reason": "휴진 취소"},
    )
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["override"]["status"] == "REVOKED"
    assert _availability(client, iso(OVERRIDE_DAY), ["UPPER"]).status_code == 200


def test_operating_hours_override_limits_last_start_and_reports_impact(
    client: TestClient, scheduling_admins: SeededIdentity
) -> None:
    csrf_token = _login_admin(client)
    patient_id = _create_patient(client, csrf_token)
    late = _book(
        client, csrf_token, patient_id, service_date=iso(OVERRIDE_DAY), start_time="11:00"
    )
    assert late.status_code == 201, late.text

    decision = _approved_override(
        client,
        csrf_token,
        service_date=iso(OVERRIDE_DAY),
        rule_type="OPERATING_HOURS",
        override_start_time="09:00",
        override_end_time="10:30",
    )
    assert [
        (item["id"], item["issue"]) for item in decision["impacted_appointments"]
    ] == [(late.json()["id"], "OUTSIDE_OPERATING_HOURS")]

    availability = _availability(client, iso(OVERRIDE_DAY), ["COLON"])
    assert availability.status_code == 200, availability.text
    assert [slot["start_time"] for slot in availability.json()["slots"]] == [
        "09:00:00",
        "09:30:00",
    ]
    assert "+H" in availability.json()["schedule_policy_version"]

    too_late = _book(
        client, csrf_token, patient_id,
        service_date=iso(OVERRIDE_DAY), start_time="10:00", procedures=COLON,
    )
    assert too_late.status_code == 409
    assert too_late.json()["code"] == "END_TIME_EXCEEDED"

    policies = client.get(
        "/api/schedule/day-policies",
        params={"start_date": iso(SHORT_DAY), "end_date": iso(OVERRIDE_DAY)},
    )
    assert policies.status_code == 200, policies.text
    wednesday, thursday = policies.json()["items"]
    assert wednesday["morning_end_time"] == "11:00:00"
    assert thursday["morning_end_time"] == "10:30:00"
    assert thursday["afternoon_allowed"] is False


def test_capacity_override_is_superseded_by_newer_approval(
    client: TestClient, scheduling_admins: SeededIdentity
) -> None:
    csrf_token = _login_admin(client)
    patient_id = _create_patient(client, csrf_token)
    first = _approved_override(
        client, csrf_token,
        service_date=iso(OVERRIDE_DAY), rule_type="CAPACITY", override_upper_capacity=1,
    )
    assert _book(
        client, csrf_token, patient_id, service_date=iso(OVERRIDE_DAY), start_time="09:00"
    ).status_code == 201
    over = _book(
        client, csrf_token, patient_id, service_date=iso(OVERRIDE_DAY), start_time="09:30"
    )
    assert over.status_code == 409
    assert over.json()["code"] == "CAPACITY_EXCEEDED"

    second = _approved_override(
        client, csrf_token,
        service_date=iso(OVERRIDE_DAY), rule_type="CAPACITY", override_upper_capacity=2,
    )
    overrides = client.get(
        "/api/schedule/overrides",
        params={"start_date": iso(OVERRIDE_DAY), "end_date": iso(OVERRIDE_DAY)},
    ).json()
    status_by_id = {item["id"]: item for item in overrides}
    assert status_by_id[first["override"]["id"]]["status"] == "SUPERSEDED"
    assert (
        status_by_id[first["override"]["id"]]["superseded_by_id"]
        == second["override"]["id"]
    )
    assert _book(
        client, csrf_token, patient_id, service_date=iso(OVERRIDE_DAY), start_time="09:30"
    ).status_code == 201


def test_invalid_override_values_are_rejected(
    client: TestClient, scheduling_admins: SeededIdentity
) -> None:
    csrf_token = _login_admin(client)
    invalid_payloads = [
        {
            "service_date": iso(OVERRIDE_DAY),
            "rule_type": "OPERATING_HOURS",
            "override_start_time": "09:00",
            "override_end_time": "10:15",
        },
        {
            "service_date": iso(CLOSED_SUNDAY),
            "rule_type": "OPERATING_HOURS",
            "override_start_time": "09:00",
            "override_end_time": "10:00",
        },
        {
            "service_date": iso(OVERRIDE_DAY),
            "rule_type": "CAPACITY",
            "override_upper_capacity": 2,
            "override_start_time": "09:00",
        },
    ]
    for payload in invalid_payloads:
        response = client.post(
            "/api/schedule/overrides",
            headers=_headers(csrf_token),
            json={"reason": "합성 잘못된 입력", **payload},
        )
        assert response.status_code == 422, payload
        assert response.json()["code"] == "INVALID_OVERRIDE_VALUE"


def test_afternoon_exception_requires_allowed_date_and_different_confirmer(
    client: TestClient, scheduling_admins: SeededIdentity
) -> None:
    csrf_token = _login_admin(client)
    patient_id = _create_patient(client, csrf_token)
    afternoon = {
        "service_date": iso(BOOKING_DAY),
        "start_time": "14:00",
        "booking_bucket": "AFTERNOON_EXCEPTION",
    }

    not_allowed = _book(
        client, csrf_token, patient_id, exception_reason="원장 승인 요청", **afternoon
    )
    assert not_allowed.status_code == 409
    assert not_allowed.json()["code"] == "AFTERNOON_NOT_ALLOWED"
    missing_reason = _book(client, csrf_token, patient_id, **afternoon)
    assert missing_reason.status_code == 422

    _approved_override(
        client, csrf_token, service_date=iso(BOOKING_DAY), rule_type="AFTERNOON_ALLOW"
    )
    availability = _availability(
        client, iso(BOOKING_DAY), ["UPPER"], booking_bucket="AFTERNOON_EXCEPTION"
    )
    assert availability.status_code == 200, availability.text
    assert availability.json()["slots"] == [
        {"start_time": "14:00:00", "end_time": "14:30:00"}
    ]

    booked = _book(
        client, csrf_token, patient_id, exception_reason="원장 승인 요청", **afternoon
    )
    assert booked.status_code == 201, booked.text
    assert booked.json()["exception_status"] == "PENDING"
    confirm_url = f"/api/appointments/{booked.json()['id']}/confirm-exception"

    self_confirm = client.post(
        confirm_url,
        headers=_headers(csrf_token),
        json={"row_version": 1, "memo": "확인"},
    )
    assert self_confirm.status_code == 409
    assert self_confirm.json()["code"] == "EXCEPTION_CONFIRMER_MUST_DIFFER"

    second_afternoon = _book(
        client, csrf_token, patient_id, exception_reason="추가 요청", **afternoon
    )
    assert second_afternoon.status_code == 409
    assert second_afternoon.json()["code"] == "AFTERNOON_LIMIT_EXCEEDED"
    # 오후 예외는 오전 Capacity와 독립적이다.
    assert _book(
        client, csrf_token, patient_id, service_date=iso(BOOKING_DAY), start_time="09:00"
    ).status_code == 201

    second_csrf = _login_second_admin(client)
    confirmed = client.post(
        confirm_url,
        headers=_headers(second_csrf),
        json={"row_version": 1, "memo": "원장 구두 승인 확인"},
    )
    assert confirmed.status_code == 200, confirmed.text
    body = confirmed.json()
    assert body["exception_status"] == "CONFIRMED"
    assert body["exception_confirmed_by_user_id"] != body["exception_registered_by_user_id"]


def test_changing_confirmed_afternoon_exception_requires_reconfirmation(
    client: TestClient, scheduling_admins: SeededIdentity
) -> None:
    csrf_token = _login_admin(client)
    patient_id = _create_patient(client, csrf_token)
    for service_date in (iso(BOOKING_DAY), iso(NEXT_BOOKING_DAY)):
        _approved_override(
            client, csrf_token, service_date=service_date, rule_type="AFTERNOON_ALLOW"
        )
    booked = _book(
        client, csrf_token, patient_id,
        service_date=iso(BOOKING_DAY), start_time="14:00",
        booking_bucket="AFTERNOON_EXCEPTION", exception_reason="원장 승인 요청",
    )
    assert booked.status_code == 201, booked.text
    appointment_url = f"/api/appointments/{booked.json()['id']}"

    second_csrf = _login_second_admin(client)
    confirmed = client.post(
        f"{appointment_url}/confirm-exception",
        headers=_headers(second_csrf),
        json={"row_version": 1, "memo": "확인"},
    )
    assert confirmed.json()["exception_status"] == "CONFIRMED"

    moved = client.patch(
        appointment_url,
        headers=_headers(second_csrf),
        json={"row_version": 2, "reason": "날짜 변경", "service_date": iso(NEXT_BOOKING_DAY)},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["exception_status"] == "PENDING"
    assert moved.json()["row_version"] == 3

    self_confirm = client.post(
        f"{appointment_url}/confirm-exception",
        headers=_headers(second_csrf),
        json={"row_version": 3, "memo": "재확인"},
    )
    assert self_confirm.json()["code"] == "EXCEPTION_CONFIRMER_MUST_DIFFER"

    csrf_token = _login_admin(client)
    reconfirmed = client.post(
        f"{appointment_url}/confirm-exception",
        headers=_headers(csrf_token),
        json={"row_version": 3, "memo": "변경 일정 재확인"},
    )
    assert reconfirmed.status_code == 200, reconfirmed.text
    assert reconfirmed.json()["exception_status"] == "CONFIRMED"


def test_moving_an_appointment_into_the_past_is_rejected(
    client: TestClient, scheduling_admins: SeededIdentity
) -> None:
    """날짜를 지난 날로 옮기는 것만 막고, 날짜를 바꾸지 않는 정정은 허용한다."""

    csrf_token = _login_admin(client)
    patient_id = _create_patient(client, csrf_token)
    booked = _book(
        client, csrf_token, patient_id, service_date=iso(BOOKING_DAY), start_time="09:00"
    )
    assert booked.status_code == 201, booked.text
    appointment_id = booked.json()["id"]

    moved = client.patch(
        f"/api/appointments/{appointment_id}",
        headers=_headers(csrf_token),
        json={
            "row_version": 1,
            "reason": "지난 날짜로 이동 시도",
            "service_date": iso(BOOKING_DAY - timedelta(days=364)),
        },
    )
    assert moved.status_code == 422, moved.text
    assert moved.json()["code"] == "SERVICE_DATE_IN_PAST"

    corrected = client.patch(
        f"/api/appointments/{appointment_id}",
        headers=_headers(csrf_token),
        json={
            "row_version": 1,
            "reason": "검진 구분 정정",
            "care_type": "SCREENING",
        },
    )
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["care_type"] == "SCREENING"


def test_past_appointment_can_still_be_corrected_in_place(
    client: TestClient,
    session_factory: sessionmaker[Session],
    scheduling_admins: SeededIdentity,
) -> None:
    """이미 지난 예약이라도 날짜를 옮기지 않는 사후 정정은 계속 가능해야 한다."""

    csrf_token = _login_admin(client)
    patient_id = _create_patient(client, csrf_token)
    booked = _book(
        client, csrf_token, patient_id, service_date=iso(BOOKING_DAY), start_time="09:00"
    )
    assert booked.status_code == 201, booked.text
    appointment_id = booked.json()["id"]
    _shift_appointment_into_past(session_factory, appointment_id)

    corrected = client.patch(
        f"/api/appointments/{appointment_id}",
        headers=_headers(csrf_token),
        json={
            "row_version": 1,
            "reason": "수면 여부 사후 정정",
            "procedures": [
                {"procedure_code": "UPPER", "sedation_mode": "NON_SEDATED"}
            ],
        },
    )
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["procedures"][0]["sedation_mode"] == "NON_SEDATED"
