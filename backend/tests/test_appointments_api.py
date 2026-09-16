from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.models import Appointment, AppointmentHistoryEvent
from tests.conftest import (
    BOOKING_DAY,
    CLOSED_SUNDAY,
    FAR_FUTURE_DAY,
    NEXT_BOOKING_DAY,
    OVERRIDE_DAY,
    SHORT_DAY,
    TEST_ORIGIN,
    iso,
    login_admin,
)


def _create_patient(client: TestClient, csrf_token: str) -> str:
    response = client.post(
        "/api/patients",
        headers={"Origin": TEST_ORIGIN, "X-CSRF-Token": csrf_token},
        json={
            "chart_number": "SYN-APT-001",
            "name": "합성예약환자",
            "birth_date": "1980-09-09",
            "sex": "FEMALE",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["patient"]["id"]


def _book(
    client: TestClient,
    *,
    csrf_token: str,
    patient_id: str,
    service_date: str,
    start_time: str,
    procedures: list[dict[str, str]],
    procedure_set: str | None = None,
) -> object:
    payload: dict[str, object] = {
        "patient_id": patient_id,
        "service_date": service_date,
        "start_time": start_time,
        "care_type": "GENERAL",
        "procedures": procedures,
    }
    if procedure_set is not None:
        payload["procedure_set"] = procedure_set
    return client.post(
        "/api/appointments",
        headers={"Origin": TEST_ORIGIN, "X-CSRF-Token": csrf_token},
        json=payload,
    )


def test_combined_set_90_occupies_ninety_minutes(client: TestClient) -> None:
    login = login_admin(client)
    csrf_token = str(login["csrf_token"])
    patient_id = _create_patient(client, csrf_token)

    availability = client.get(
        "/api/appointments/availability",
        params=[
            ("service_date", iso(BOOKING_DAY)),
            ("procedures", "UPPER"),
            ("procedures", "COLON"),
            ("procedure_set", "SET_90"),
        ],
    )
    assert availability.status_code == 200, availability.text
    assert availability.json()["duration_minutes"] == 90
    assert availability.json()["procedure_set"] == "SET_90"
    assert availability.json()["slots"][0] == {
        "start_time": "09:00:00",
        "end_time": "10:30:00",
    }

    response = _book(
        client,
        csrf_token=csrf_token,
        patient_id=patient_id,
        service_date=iso(BOOKING_DAY),
        start_time="09:00",
        procedures=[
            {"procedure_code": "UPPER", "sedation_mode": "SEDATED"},
            {"procedure_code": "COLON", "sedation_mode": "SEDATED"},
        ],
        procedure_set="SET_90",
    )
    assert response.status_code == 201, response.text
    assert response.json()["duration_minutes"] == 90
    assert response.json()["procedure_set"] == "SET_90"


def test_create_list_and_history_are_persisted(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    login = login_admin(client)
    csrf_token = str(login["csrf_token"])
    patient_id = _create_patient(client, csrf_token)

    availability = client.get(
        "/api/appointments/availability",
        params=[
            ("service_date", iso(BOOKING_DAY)),
            ("procedures", "UPPER"),
        ],
    )
    assert availability.status_code == 200, availability.text
    assert availability.json()["slots"][0]["start_time"] == "09:00:00"

    response = _book(
        client,
        csrf_token=csrf_token,
        patient_id=patient_id,
        service_date=iso(BOOKING_DAY),
        start_time="09:00",
        procedures=[
            {"procedure_code": "UPPER", "sedation_mode": "SEDATED"}
        ],
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["patient_name"] == "합성예약환자"
    assert payload["duration_minutes"] == 30
    assert payload["age"] == 46

    listing = client.get(
        "/api/appointments",
        params={"start_date": iso(BOOKING_DAY), "end_date": iso(BOOKING_DAY)},
    )
    assert listing.status_code == 200
    assert listing.json()["total"] == 1
    assert listing.json()["items"][0]["id"] == payload["id"]

    with session_factory() as db:
        assert db.scalar(select(func.count()).select_from(Appointment)) == 1
        history = db.scalar(select(AppointmentHistoryEvent))
        assert history is not None
        assert history.event_type == "CREATED"
        assert history.before_values is None


def test_overlapping_appointment_is_blocked(client: TestClient) -> None:
    login = login_admin(client)
    csrf_token = str(login["csrf_token"])
    patient_id = _create_patient(client, csrf_token)
    first = _book(
        client,
        csrf_token=csrf_token,
        patient_id=patient_id,
        service_date=iso(BOOKING_DAY),
        start_time="09:00",
        procedures=[
            {"procedure_code": "COLON", "sedation_mode": "NON_SEDATED"}
        ],
    )
    assert first.status_code == 201

    second = _book(
        client,
        csrf_token=csrf_token,
        patient_id=patient_id,
        service_date=iso(BOOKING_DAY),
        start_time="09:30",
        procedures=[
            {"procedure_code": "UPPER", "sedation_mode": "SEDATED"}
        ],
    )
    assert second.status_code == 409
    assert second.json()["code"] == "TIME_CONFLICT"


def test_weekday_upper_capacity_blocks_sixth_case(client: TestClient) -> None:
    login = login_admin(client)
    csrf_token = str(login["csrf_token"])
    patient_id = _create_patient(client, csrf_token)
    procedure = [
        {"procedure_code": "UPPER", "sedation_mode": "SEDATED"}
    ]
    for start_time in ("09:00", "09:30", "10:00", "10:30", "11:00"):
        response = _book(
            client,
            csrf_token=csrf_token,
            patient_id=patient_id,
            service_date=iso(BOOKING_DAY),
            start_time=start_time,
            procedures=procedure,
        )
        assert response.status_code == 201, response.text

    sixth = _book(
        client,
        csrf_token=csrf_token,
        patient_id=patient_id,
        service_date=iso(BOOKING_DAY),
        start_time="11:30",
        procedures=procedure,
    )
    assert sixth.status_code == 409
    assert sixth.json()["code"] == "CAPACITY_EXCEEDED"


def test_sunday_and_unapproved_afternoon_exception_are_closed(
    client: TestClient,
) -> None:
    login_admin(client)
    sunday = client.get(
        "/api/appointments/availability",
        params=[
            ("service_date", iso(CLOSED_SUNDAY)),
            ("procedures", "UPPER"),
        ],
    )
    assert sunday.status_code == 409
    assert sunday.json()["code"] == "SCHEDULE_CLOSED"

    afternoon = client.get(
        "/api/appointments/availability",
        params=[
            ("service_date", iso(BOOKING_DAY)),
            ("procedures", "UPPER"),
            ("booking_bucket", "AFTERNOON_EXCEPTION"),
        ],
    )
    assert afternoon.status_code == 409
    assert afternoon.json()["code"] == "AFTERNOON_NOT_ALLOWED"


def test_appointment_create_requires_csrf(client: TestClient) -> None:
    login = login_admin(client)
    patient_id = _create_patient(client, str(login["csrf_token"]))
    response = client.post(
        "/api/appointments",
        json={
            "patient_id": patient_id,
            "service_date": iso(BOOKING_DAY),
            "start_time": "09:00",
            "care_type": "GENERAL",
            "procedures": [
                {"procedure_code": "UPPER", "sedation_mode": "SEDATED"}
            ],
        },
    )
    assert response.status_code == 403
    assert response.json()["code"] in {"ORIGIN_NOT_ALLOWED", "CSRF_TOKEN_INVALID"}


def test_past_service_date_is_rejected_on_create(client: TestClient) -> None:
    """연도를 잘못 입력해 일정 화면에 보이지 않는 예약이 생기는 것을 막는다."""

    login = login_admin(client)
    csrf_token = str(login["csrf_token"])
    patient_id = _create_patient(client, csrf_token)
    procedure = [{"procedure_code": "UPPER", "sedation_mode": "SEDATED"}]

    past = _book(
        client,
        csrf_token=csrf_token,
        patient_id=patient_id,
        service_date=iso(BOOKING_DAY - timedelta(days=364)),
        start_time="09:00",
        procedures=procedure,
    )
    assert past.status_code == 422, past.text
    assert past.json()["code"] == "SERVICE_DATE_IN_PAST"

    assert _book(
        client,
        csrf_token=csrf_token,
        patient_id=patient_id,
        service_date=iso(BOOKING_DAY),
        start_time="09:00",
        procedures=procedure,
    ).status_code == 201


def test_appointment_range_covers_a_six_week_month_grid(
    client: TestClient,
) -> None:
    """월간 달력은 앞뒤 주를 포함해 42일 Grid를 한 번에 조회한다."""

    login_admin(client)
    grid_start = BOOKING_DAY

    within_limit = client.get(
        "/api/appointments",
        params={
            "start_date": iso(grid_start),
            "end_date": iso(grid_start + timedelta(days=41)),
        },
    )
    assert within_limit.status_code == 200, within_limit.text

    beyond_limit = client.get(
        "/api/appointments",
        params={
            "start_date": iso(grid_start),
            "end_date": iso(grid_start + timedelta(days=43)),
        },
    )
    assert beyond_limit.status_code == 422
    assert beyond_limit.json()["code"] == "DATE_RANGE_INVALID"
