"""실제 PostgreSQL에서만 확인할 수 있는 Migration·동시성·Timezone 통합 Test.

`TEST_POSTGRES_URL`(비어 있어도 되는 시험 전용 Database의 superuser URL)이 없으면
건너뛴다. 이 Test는 대상 Database의 `public`·`iam` Schema를 지우고 다시 만든다.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
from collections.abc import Generator, Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.cli.seed_identity import seed_roles_and_permissions, seed_schedule_resource
from app.core.config import Settings
from app.core.security import hash_password
from app.db.session import get_db
from app.main import create_app
from app.models import User, UserRole
from tests.conftest import ADMIN_PASSWORD, TEST_ORIGIN


POSTGRES_URL = os.environ.get("TEST_POSTGRES_URL")
PROJECT_ROOT = Path(__file__).resolve().parents[2]
# `user_sessions.created_ip`가 PostgreSQL `inet`이므로 실제 IP 형식을 쓴다.
LOCAL_CLIENT = ("127.0.0.1", 50000)
UPPER =[{"procedure_code": "UPPER", "sedation_mode": "SEDATED"}]
COLON = [{"procedure_code": "COLON", "sedation_mode": "NON_SEDATED"}]

pytestmark = pytest.mark.skipif(
    POSTGRES_URL is None,
    reason="TEST_POSTGRES_URL이 없어 PostgreSQL 통합 Test를 건너뜁니다.",
)


def _alembic(*arguments: str) -> None:
    environment = os.environ.copy()
    environment.update({"APP_ENV": "test", "DATABASE_URL": str(POSTGRES_URL)})
    completed = subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=PROJECT_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    assert completed.returncode == 0, completed.stderr


@pytest.fixture(scope="module")
def postgres_session_factory() -> Iterator[sessionmaker[Session]]:
    reset_engine = create_engine(str(POSTGRES_URL), isolation_level="AUTOCOMMIT")
    with reset_engine.connect() as connection:
        connection.execute(text("DROP SCHEMA IF EXISTS iam CASCADE"))
        connection.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    reset_engine.dispose()

    _alembic("upgrade", "head")
    # 최신 Migration의 Downgrade와 재적용도 실제 PostgreSQL에서 확인한다.
    _alembic("downgrade", "20260915_0004")
    _alembic("upgrade", "head")

    # 서버 기본 Timezone과 무관하게 동작하는지 보기 위해 Session을 UTC로 고정한다.
    engine = create_engine(
        str(POSTGRES_URL), connect_args={"options": "-c timezone=UTC"}
    )
    factory = sessionmaker(
        bind=engine, class_=Session, expire_on_commit=False, autoflush=False
    )
    with factory() as db:
        roles = seed_roles_and_permissions(db)
        seed_schedule_resource(db)
        admin = User(
            login_id_normalized="admin.test",
            password_hash=hash_password(ADMIN_PASSWORD),
            display_name="합성 관리자",
            is_active=True,
            must_change_password=False,
        )
        admin.role_assignments = [UserRole(role=roles["ADMIN"])]
        db.add(admin)
        db.commit()
    try:
        yield factory
    finally:
        engine.dispose()


@pytest.fixture
def postgres_app(postgres_session_factory: sessionmaker[Session]) -> FastAPI:
    with postgres_session_factory() as db:
        db.execute(
            text(
                "TRUNCATE appointment_history_events, appointment_procedures, "
                "appointments, schedule_date_overrides, patient_history_events, "
                "patients CASCADE"
            )
        )
        db.commit()

    app = create_app(
        Settings(
            environment="test",
            database_url=str(POSTGRES_URL),
            session_cookie_name="clinic_session_test",
            session_cookie_secure=False,
            allowed_origins=(TEST_ORIGIN,),
            allowed_hosts=("testserver",),
            enforce_internal_subnet=False,
            bind_session_to_ip=False,
        )
    )

    def override_get_db() -> Generator[Session, None, None]:
        with postgres_session_factory() as db:
            try:
                yield db
            except Exception:
                db.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    return app


def _login(client: TestClient) -> str:
    response = client.post(
        "/api/auth/login",
        headers={"Origin": TEST_ORIGIN},
        json={"login_id": "admin.test", "password": ADMIN_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return str(response.json()["csrf_token"])


def _headers(csrf_token: str) -> dict[str, str]:
    return {"Origin": TEST_ORIGIN, "X-CSRF-Token": csrf_token}


def _create_patient(client: TestClient, csrf_token: str) -> str:
    response = client.post(
        "/api/patients",
        headers=_headers(csrf_token),
        json={
            "chart_number": "SYN-PG-001",
            "name": "합성통합환자",
            "birth_date": "1970-01-01",
            "sex": "FEMALE",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["patient"]["id"]


def _booking(patient_id: str, start_time: str, procedures: list[dict[str, str]]) -> dict[str, object]:
    return {
        "patient_id": patient_id,
        "service_date": "2026-09-10",
        "start_time": start_time,
        "care_type": "GENERAL",
        "procedures": procedures,
    }


def test_concurrent_bookings_for_same_slot_allow_only_one(
    postgres_app: FastAPI,
) -> None:
    with (
        TestClient(postgres_app, base_url="https://testserver", client=LOCAL_CLIENT) as first,
        TestClient(postgres_app, base_url="https://testserver", client=LOCAL_CLIENT) as second,
    ):
        first_csrf = _login(first)
        second_csrf = _login(second)
        patient_id = _create_patient(first, first_csrf)
        barrier = threading.Barrier(2)
        status_codes: list[int] = []
        lock = threading.Lock()

        def book(client: TestClient, csrf_token: str) -> None:
            barrier.wait()
            response = client.post(
                "/api/appointments",
                headers=_headers(csrf_token),
                json=_booking(patient_id, "09:00", COLON),
            )
            with lock:
                status_codes.append(response.status_code)

        threads = [
            threading.Thread(target=book, args=(first, first_csrf)),
            threading.Thread(target=book, args=(second, second_csrf)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)

        assert sorted(status_codes) == [201, 409]
        listing = first.get(
            "/api/appointments",
            params={"start_date": "2026-09-10", "end_date": "2026-09-10"},
        )
        assert listing.json()["total"] == 1


def test_times_stay_in_seoul_when_database_session_uses_utc(
    postgres_app: FastAPI,
) -> None:
    with TestClient(postgres_app, base_url="https://testserver", client=LOCAL_CLIENT) as client:
        csrf_token = _login(client)
        patient_id = _create_patient(client, csrf_token)
        booked = client.post(
            "/api/appointments",
            headers=_headers(csrf_token),
            json=_booking(patient_id, "09:00", COLON),
        )
        assert booked.status_code == 201, booked.text
        assert booked.json()["start_time"] == "09:00:00"

        overlap = client.post(
            "/api/appointments",
            headers=_headers(csrf_token),
            json=_booking(patient_id, "09:30", UPPER),
        )
        assert overlap.status_code == 409
        assert overlap.json()["code"] == "TIME_CONFLICT"

        availability = client.get(
            "/api/appointments/availability",
            params=[("service_date", "2026-09-10"), ("procedures", "UPPER")],
        )
        assert availability.json()["slots"][0]["start_time"] == "10:00:00"

        changed = client.patch(
            f"/api/appointments/{booked.json()['id']}",
            headers=_headers(csrf_token),
            json={"row_version": 1, "reason": "시간 변경", "start_time": "10:00"},
        )
        assert changed.status_code == 200, changed.text
        assert changed.json()["start_time"] == "10:00:00"
