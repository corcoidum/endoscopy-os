from __future__ import annotations

import os
from collections.abc import Generator
from dataclasses import dataclass
from datetime import date, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

# app.main의 운영용 global app 생성 전에 Test 환경임을 명시한다.
os.environ.setdefault("APP_ENV", "test")

import app.models  # noqa: F401
from app.core.config import Settings
from app.core.security import hash_password
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models import (
    Permission,
    Role,
    RolePermission,
    ScheduleResource,
    User,
    UserRole,
)

TEST_ORIGIN = "https://clinic.test"
ADMIN_PASSWORD = "Synthetic-Admin-Password-42!"


def _next_weekday(target_isoweekday: int) -> date:
    """오늘보다 뒤에 오는 가장 가까운 해당 요일을 돌려준다."""

    from app.services.appointments import today_in_seoul

    today = today_in_seoul()
    ahead = (target_isoweekday - today.isoweekday()) % 7
    return today + timedelta(days=ahead or 7)


# 예약 API는 지난 날짜 등록을 막으므로 Test 날짜는 실행일 기준으로 계산한다.
# 서로의 간격은 고정이라 요일별 운영규칙(월·화·목·금 / 수·토 / 일)이 항상 같다.
BOOKING_DAY = _next_weekday(4)          # 목요일: 09:00~12:00, 위 5건·대장 3건
NEXT_BOOKING_DAY = BOOKING_DAY + timedelta(days=1)   # 금요일: 같은 운영규칙
CLOSED_SUNDAY = BOOKING_DAY + timedelta(days=3)      # 일요일: 기본 휴진
SHORT_DAY = BOOKING_DAY + timedelta(days=6)          # 수요일: 09:00~11:00
OVERRIDE_DAY = BOOKING_DAY + timedelta(days=7)       # 다음 주 목요일
FAR_FUTURE_DAY = _next_weekday(4) + timedelta(days=364)


def iso(value: date) -> str:
    return value.isoformat()


@dataclass(frozen=True)
class SeededIdentity:
    user_id: UUID
    role_id: UUID
    permission_id: UUID


@pytest.fixture
def session_factory() -> Generator[sessionmaker[Session]]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        execution_options={"schema_translate_map": {"iam": None}},
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(
        bind=engine,
        class_=Session,
        expire_on_commit=False,
        autoflush=False,
    )
    try:
        yield factory
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture
def seeded_identity(session_factory: sessionmaker[Session]) -> SeededIdentity:
    with session_factory() as db:
        permissions = [
            Permission(
                code=code,
                description_ko=description,
            )
            for code, description in (
                ("identity.manage", "사용자와 역할 관리"),
                ("patient.read", "환자 조회"),
                ("patient.create", "환자 등록"),
                ("patient.update", "환자정보 변경"),
                ("appointment.read", "일정과 예약 조회"),
                ("appointment.create", "예약 생성"),
            )
        ]
        role = Role(code="ADMIN", name_ko="관리자", is_active=True)
        role.permission_assignments = [
            RolePermission(permission=permission)
            for permission in permissions
        ]
        user = User(
            login_id_normalized="admin.test",
            password_hash=hash_password(ADMIN_PASSWORD),
            display_name="합성 관리자",
            is_active=True,
            must_change_password=False,
        )
        user.role_assignments = [UserRole(role=role)]
        db.add_all(
            [
                user,
                ScheduleResource(
                    code="ENDOSCOPY_MAIN",
                    name="내시경 공용 일정",
                    is_active=True,
                ),
            ]
        )
        db.commit()
        return SeededIdentity(
            user_id=user.id,
            role_id=role.id,
            permission_id=permissions[0].id,
        )


@pytest.fixture
def test_settings() -> Settings:
    return Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_cookie_name="clinic_session_test",
        session_cookie_secure=False,
        allowed_origins=(TEST_ORIGIN,),
        allowed_hosts=("testserver",),
        enforce_internal_subnet=False,
        bind_session_to_ip=False,
    )


@pytest.fixture
def client(
    session_factory: sessionmaker[Session],
    seeded_identity: SeededIdentity,
    test_settings: Settings,
) -> Generator[TestClient]:
    app = create_app(test_settings)

    def override_get_db() -> Generator[Session]:
        with session_factory() as db:
            try:
                yield db
            except Exception:
                db.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client


def login_admin(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/api/auth/login",
        headers={"Origin": TEST_ORIGIN},
        json={"login_id": "admin.test", "password": ADMIN_PASSWORD},
    )
    assert response.status_code == 200
    return response.json()
