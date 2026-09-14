from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.models import Appointment, AppointmentHistoryEvent
from tests.conftest import TEST_ORIGIN, login_admin


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
) -> object:
    return client.post(
        "/api/appointments",
        headers={"Origin": TEST_ORIGIN, "X-CSRF-Token": csrf_token},
        json={
            "patient_id": patient_id,
            "service_date": service_date,
            "start_time": start_time,
            "care_type": "GENERAL",
            "procedures": procedures,
        },
    )


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
            ("service_date", "2026-09-10"),
            ("procedures", "UPPER"),
        ],
    )
    assert availability.status_code == 200, availability.text
    assert availability.json()["slots"][0]["start_time"] == "09:00:00"

    response = _book(
        client,
        csrf_token=csrf_token,
        patient_id=patient_id,
        service_date="2026-09-10",
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
        params={"start_date": "2026-09-10", "end_date": "2026-09-10"},
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
        service_date="2026-09-10",
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
        service_date="2026-09-10",
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
            service_date="2026-09-10",
            start_time=start_time,
            procedures=procedure,
        )
        assert response.status_code == 201, response.text

    sixth = _book(
        client,
        csrf_token=csrf_token,
        patient_id=patient_id,
        service_date="2026-09-10",
        start_time="11:30",
        procedures=procedure,
    )
    assert sixth.status_code == 409
    assert sixth.json()["code"] == "CAPACITY_EXCEEDED"


def test_sunday_and_afternoon_exception_are_not_open_yet(
    client: TestClient,
) -> None:
    login_admin(client)
    sunday = client.get(
        "/api/appointments/availability",
        params=[
            ("service_date", "2026-09-13"),
            ("procedures", "UPPER"),
        ],
    )
    assert sunday.status_code == 409
    assert sunday.json()["code"] == "SCHEDULE_CLOSED"

    afternoon = client.get(
        "/api/appointments/availability",
        params=[
            ("service_date", "2026-09-10"),
            ("procedures", "UPPER"),
            ("booking_bucket", "AFTERNOON_EXCEPTION"),
        ],
    )
    assert afternoon.status_code == 409
    assert afternoon.json()["code"] == "AFTERNOON_POLICY_NOT_IMPLEMENTED"


def test_appointment_create_requires_csrf(client: TestClient) -> None:
    login = login_admin(client)
    patient_id = _create_patient(client, str(login["csrf_token"]))
    response = client.post(
        "/api/appointments",
        json={
            "patient_id": patient_id,
            "service_date": "2026-09-10",
            "start_time": "09:00",
            "care_type": "GENERAL",
            "procedures": [
                {"procedure_code": "UPPER", "sedation_mode": "SEDATED"}
            ],
        },
    )
    assert response.status_code == 403
    assert response.json()["code"] in {"ORIGIN_NOT_ALLOWED", "CSRF_TOKEN_INVALID"}
