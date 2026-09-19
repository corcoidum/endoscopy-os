from __future__ import annotations

from datetime import UTC, date, datetime, time

import pytest
from fastapi.testclient import TestClient

from app.core.exceptions import ApiError
from app.models import Appointment
from app.services.appointments import (
    ScheduleContext,
    to_seoul,
    validate_standard_morning,
)
from tests.conftest import login_admin


def test_to_seoul_handles_naive_and_utc_values() -> None:
    naive = datetime(2026, 9, 10, 9, 0)  # noqa: DTZ001 - naive 입력을 의도적으로 만든다.
    utc_value = datetime(2026, 9, 10, 0, 0, tzinfo=UTC)

    assert to_seoul(naive).time() == time(9, 0)
    assert to_seoul(utc_value).time() == time(9, 0)


def test_overlap_detection_ignores_database_session_timezone() -> None:
    # PostgreSQL Session이 UTC이면 09:00 KST 예약이 00:00 UTC로 돌아온다.
    existing = Appointment(
        scheduled_start_at=datetime(2026, 9, 10, 0, 0, tzinfo=UTC),
        scheduled_end_at=datetime(2026, 9, 10, 0, 30, tzinfo=UTC),
    )

    with pytest.raises(ApiError) as captured:
        validate_standard_morning(
            service_date=date(2026, 9, 10),
            start_time=time(9, 0),
            procedure_codes={"UPPER"},
            context=ScheduleContext([existing], 1, 0),
        )

    assert captured.value.code == "TIME_CONFLICT"


def test_authenticated_response_exposes_session_expiry(client: TestClient) -> None:
    login_payload = login_admin(client)

    response = client.get("/api/auth/me")

    assert response.status_code == 200
    header_value = response.headers["X-Session-Expires-At"]
    expires_at = datetime.fromisoformat(header_value)
    assert expires_at <= datetime.fromisoformat(
        str(login_payload["absolute_expires_at"]).replace("Z", "+00:00")
    )
    assert expires_at > datetime.now(UTC)
